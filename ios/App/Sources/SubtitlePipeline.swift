import Foundation
import LiveTranslateCore

/// Orchestrates the Phase 1 vertical slice:
/// microphone → VAD → whisper.cpp (local STT) → sentence assembly → subtitle state.
///
/// Constants and thresholds mirror the macOS `python/engine.py` processing loop:
/// silence finalize at 0.35 s, segment timeout at 6 s, partial windows of the
/// last 5 s, and a 0.2 s processing cadence.
@MainActor
final class SubtitlePipeline: ObservableObject {
    enum Phase: Equatable {
        case idle
        case loadingModel
        case listening
        case failed(String)
    }

    @Published private(set) var phase: Phase = .idle

    let model = LiveSubtitleModel()

    private let stt = STTEngine()
    // Adaptive VAD: threshold follows the ambient noise floor instead of the
    // fixed 0.01 RMS cutoff, so quiet mics / quiet rooms no longer reject speech.
    private let vad = AdaptiveVoiceActivityDetector()
    private let assembler = SentenceAssembler()
    private var translator: TranslationProviding = PassthroughTranslationProvider()

    private var audio: AudioSessionManager?
    private var settings: ObservableSettings

    // Thread-safe audio buffer (audio thread appends, processing loop reads).
    private let bufferLock = NSLock()
    private var speechBuffer: [Float] = []
    private var lastSpeechTime: Date?

    private var processingTask: Task<Void, Never>?
    private var isListening = false
    private var lastTranscriptTime = Date.distantPast

    // Engine constants (mirror engine.py).
    let silenceThreshold: TimeInterval = 0.35
    let maxSegmentDuration: TimeInterval = 6.0
    let processingInterval: TimeInterval = 0.2
    let partialWindow: TimeInterval = 5.0
    let minAudioDuration: TimeInterval = 0.2

    init(settings: ObservableSettings) {
        self.settings = settings
    }

    // MARK: - Lifecycle

    public func start() async {
        guard !isListening else { return }
        DebugLog.shared.clear()
        DebugLog.shared.log("başlat: izin isteniyor")
        guard await AudioSessionManager.requestPermission() else {
            DebugLog.shared.log("başlat: MİKROFON İZNİ REDDEDİLDİ")
            phase = .failed("Mikrofon izni gerekli. Ayarlar → Gizlilik → Mikrofon.")
            return
        }

        guard let modelURL = await ensureModel() else { return }

        phase = .loadingModel
        DebugLog.shared.log("model yükleniyor: \(modelURL.lastPathComponent)")
        let loadResult = await Task.detached(priority: .userInitiated) { [stt] in
            stt.loadModel(at: modelURL)
        }.value
        guard case .success = loadResult else {
            DebugLog.shared.log("model YÜKLENEMEDİ")
            phase = .failed("Whisper modeli yüklenemedi.")
            return
        }
        DebugLog.shared.log("model yüklendi ✓ (gpu=\(STTEngine.usesGPU ? "açık" : "kapalı"))")

        // Sanity: log the selected source language — a common cause of silent
        // drops is a fixed source language mismatching the detected one.
        DebugLog.shared.log("kaynak dil: \(settings.sourceLanguage == "auto" ? "otomatik" : settings.sourceLanguage)")

        do {
            let audio = try AudioSessionManager()
            audio.onAudioChunk = { [weak self] chunk in
                self?.handleAudioChunk(chunk)
            }
            try audio.start()
            self.audio = audio
            DebugLog.shared.log("ses motoru başladı ✓ (16kHz mono)")
        } catch {
            DebugLog.shared.log("ses motoru BAŞLATILAMADI: \(error.localizedDescription)")
            phase = .failed(error.localizedDescription)
            return
        }

        isListening = true
        phase = .listening
        DebugLog.shared.log("dinleme başladı — altyazı bekleniyor")
        model.start()
        await LiveActivityManager.shared.start(
            sourceLanguage: sourceLanguageOrNil ?? "auto",
            targetLanguage: settings.targetLanguage
        )

        processingTask?.cancel()
        processingTask = Task { [weak self] in
            let interval = UInt64((self?.processingInterval ?? 0.2) * 1_000_000_000)
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: interval)
                await self?.processOnce()
            }
        }
    }

    public func stop() {
        DebugLog.shared.log("durdu — oturum sonlandı")
        processingTask?.cancel()
        processingTask = nil
        audio?.stop()
        audio = nil
        isListening = false
        model.stop()
        phase = .idle
        clearBuffer()
        resetVAD()
        assembler.reset()
        Task { await LiveActivityManager.shared.end() }
    }

    // MARK: - Model management

    private func ensureModel() async -> URL? {
        let option = AppSettings.modelOption(forID: settings.whisperModel) ?? AppSettings.whisperModelOptions[0]
        if let url = ModelManager.shared.localURL(for: option) {
            return url
        }
        // Model missing — kick off a download and surface instructions to the user.
        ModelManager.shared.download(option)
        phase = .failed("Whisper modeli indirilmedi. Ayarlar → Model'e gidin ve \"\(option.displayName)\" modelini indirin.")
        return nil
    }

    // MARK: - Audio handling

    private var lastVADLogTime = Date.distantPast

    private func handleAudioChunk(_ chunk: [Float]) {
        let rms = PCMUtils.rms(chunk)
        let isSpeech = vad.isSpeech(chunk)
        bufferLock.lock()
        if isSpeech {
            speechBuffer.append(contentsOf: chunk)
            lastSpeechTime = Date()
        }
        bufferLock.unlock()
        // Diagnostics: rate-limit to ~1 line/second so the ring buffer isn't
        // flooded at the ~50-100 Hz chunk cadence. The rms value tells us
        // whether the mic is live at all vs. the VAD rejecting the level.
        let now = Date()
        guard now.timeIntervalSince(lastVADLogTime) > 1.0 else { return }
        lastVADLogTime = now
        if isSpeech {
            DebugLog.shared.log(String(format: "VAD: ses (rms=%.3f, eşik=%.3f)", rms, vad.currentThreshold))
        } else {
            DebugLog.shared.log(String(format: "VAD: SESSİZ/eşik altı (rms=%.3f, eşik=%.3f)", rms, vad.currentThreshold))
        }
    }

    private func clearBuffer() {
        bufferLock.lock()
        speechBuffer.removeAll()
        lastSpeechTime = nil
        bufferLock.unlock()
    }

    // MARK: - VAD reset

    /// Re-learn the noise floor between sessions (room may have changed).
    public func resetVAD() {
        vad.reset()
        DebugLog.shared.log("VAD: gürültü tabanı sıfırlandı")
    }

    // MARK: - Processing loop

    private func processOnce() async {
        guard isListening else { return }

        bufferLock.lock()
        let buffer = speechBuffer
        let lastSpeech = lastSpeechTime
        bufferLock.unlock()

        let duration = Double(buffer.count) / 16000.0
        guard duration >= minAudioDuration else { return }

        // Diagnostics: if this fires repeatedly with no whisper output, the VAD
        // is rejecting the mic level (see the VAD: ses/kesme lines above).

        // Rate limit partial passes.
        let now = Date()
        guard now.timeIntervalSince(lastTranscriptTime) >= processingInterval else { return }

        let isSilenceFinal = lastSpeech.map { now.timeIntervalSince($0) >= silenceThreshold } ?? false
        let isTimeoutFinal = duration > maxSegmentDuration
        let isFinal = isSilenceFinal || isTimeoutFinal

        // CPU saving: partial passes only process the last N seconds.
        let samples: [Float]
        if !isFinal {
            let maxPartial = Int(16000.0 * partialWindow)
            samples = buffer.count > maxPartial ? Array(buffer.suffix(maxPartial)) : buffer
        } else {
            samples = buffer
        }

        // Transcribe off the main thread (whisper is blocking). Capture values
        // first to avoid touching MainActor-isolated state from the detached task.
        let sourceLanguage = sourceLanguageOrNil
        let contextPrompt = assembler.lastContext
        let result = await Task.detached(priority: .userInitiated) { [stt] in
            stt.transcribe(samples: samples, language: sourceLanguage, prompt: contextPrompt)
        }.value

        guard case .success(let transcription) = result else { return }

        let text = transcription.text
        guard !text.isEmpty else {
            DebugLog.shared.log("whisper: boş metin (durum=ok, final=\(isFinal), süre=\(String(format: "%.2f", duration))s)")
            if isFinal { clearBuffer() }
            return
        }

        // Language match check (mirrors engine.py §5.5).
        if let detected = transcription.language,
           let selected = sourceLanguageOrNil,
           detected != selected {
            DebugLog.shared.log("DİL UYUMSUZLUĞU: algılanan='\(detected)' seçili='\(selected)' — atlandı (final=\(isFinal))")
            if isFinal { clearBuffer() }
            return
        }

        DebugLog.shared.log("whisper: '\(text)' (final=\(isFinal), dil=\(transcription.language ?? "?"))")

        guard let published = assembler.process(text: text, isFinal: isFinal, isTimeoutCut: isTimeoutFinal) else {
            if isFinal { clearBuffer() }
            return
        }

        let translated = await translator.translate(published, isFinal: isFinal)
        model.update(segment: SubtitleSegment(
            original: published,
            translated: translated,
            isFinal: isFinal,
            confidence: 0,
            source: "local"
        ))
        await LiveActivityManager.shared.update(original: published, translated: translated, isFinal: isFinal)

        lastTranscriptTime = Date()
        if isFinal {
            clearBuffer()
            DebugLog.shared.log(String(format: "cümle tamamlandı ✓ (toplam %.1fs)", duration))
        }
    }

    private var sourceLanguageOrNil: String? {
        let value = settings.sourceLanguage
        return value == "auto" || value.isEmpty ? nil : value
    }

    /// Allows the settings screen to swap in a cloud translation client later.
    public func setTranslator(_ translator: TranslationProviding) {
        self.translator = translator
    }
}
