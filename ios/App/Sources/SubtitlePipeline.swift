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
    private let vad = VoiceActivityDetector(sampleRate: 16000)
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
        guard await AudioSessionManager.requestPermission() else {
            phase = .failed("Mikrofon izni gerekli. Ayarlar → Gizlilik → Mikrofon.")
            return
        }

        guard let modelURL = await ensureModel() else { return }

        phase = .loadingModel
        let loadResult = await Task.detached(priority: .userInitiated) { [stt] in
            stt.loadModel(at: modelURL)
        }.value
        guard case .success = loadResult else {
            phase = .failed("Whisper modeli yüklenemedi.")
            return
        }

        do {
            let audio = try AudioSessionManager()
            audio.onAudioChunk = { [weak self] chunk in
                self?.handleAudioChunk(chunk)
            }
            try audio.start()
            self.audio = audio
        } catch {
            phase = .failed(error.localizedDescription)
            return
        }

        isListening = true
        phase = .listening
        model.start()

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
        processingTask?.cancel()
        processingTask = nil
        audio?.stop()
        audio = nil
        isListening = false
        model.stop()
        phase = .idle
        clearBuffer()
        assembler.reset()
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

    private func handleAudioChunk(_ chunk: [Float]) {
        bufferLock.lock()
        if vad.isSpeech(chunk) {
            speechBuffer.append(contentsOf: chunk)
            lastSpeechTime = Date()
        }
        bufferLock.unlock()
    }

    private func clearBuffer() {
        bufferLock.lock()
        speechBuffer.removeAll()
        lastSpeechTime = nil
        bufferLock.unlock()
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
            if isFinal { clearBuffer() }
            return
        }

        // Language match check (mirrors engine.py §5.5).
        if let detected = transcription.language,
           let selected = sourceLanguageOrNil,
           detected != selected {
            if isFinal { clearBuffer() }
            return
        }

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

        lastTranscriptTime = Date()
        if isFinal {
            clearBuffer()
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
