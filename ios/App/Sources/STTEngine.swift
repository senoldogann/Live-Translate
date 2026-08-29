import Foundation
import whisper

/// A transcribed word with its position in the audio timeline (for karaoke UI).
public struct TranscribedWord: Equatable, Sendable {
    public let text: String
    public let startMs: Int64
    public let endMs: Int64

    public init(text: String, startMs: Int64, endMs: Int64) {
        self.text = text
        self.startMs = startMs
        self.endMs = endMs
    }
}

/// Result of one transcription pass.
public struct TranscriptionResult: Equatable, Sendable {
    public let text: String
    /// Detected language code (e.g. "en", "tr") — set when auto-detection ran.
    public let language: String?
    /// Token-level timestamps when available (karaoke highlight).
    public let words: [TranscribedWord]

    public init(text: String, language: String?, words: [TranscribedWord]) {
        self.text = text
        self.language = language
        self.words = words
    }
}

/// Swift wrapper around the whisper.cpp C API.
///
/// A whisper context is NOT thread-safe, so all calls are serialized through an
/// internal queue. Model loading and transcription are blocking CPU work and
/// must be called from a background context.
public final class STTEngine {
    public enum EngineError: Error, LocalizedError {
        case modelNotFound
        case couldNotInitializeContext
        case transcriptionFailed

        public var errorDescription: String? {
            switch self {
            case .modelNotFound:
                return "Model dosyası bulunamadı. Ayarlar'dan indirin."
            case .couldNotInitializeContext:
                return "Whisper modeli yüklenemedi."
            case .transcriptionFailed:
                return "Transkripsiyon başarısız oldu."
            }
        }
    }

    private let queue = DispatchQueue(label: "com.stealth.stt.engine", qos: .userInitiated)
    private var context: OpaquePointer?

    public private(set) var isLoaded = false
    public private(set) var loadedModelURL: URL?

    /// Whether the engine uses GPU (true on device, false in simulator).
    public static var usesGPU: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return true
        #endif
    }

    public init() {}

    deinit {
        queue.sync {
            if let context { whisper_free(context) }
            context = nil
        }
    }

    // MARK: - Model loading

    /// Loads a ggml model file. Blocking; call from a background task.
    @discardableResult
    public func loadModel(at url: URL) -> Result<Void, EngineError> {
        queue.sync {
            if let context {
                whisper_free(context)
                self.context = nil
            }
            guard FileManager.default.fileExists(atPath: url.path) else {
                isLoaded = false
                return .failure(.modelNotFound)
            }

            var params = whisper_context_default_params()
            #if targetEnvironment(simulator)
            params.use_gpu = false
            #else
            params.flash_attn = true
            params.use_gpu = true
            #endif

            guard let ctx = whisper_init_from_file_with_params(url.path, params) else {
                isLoaded = false
                return .failure(.couldNotInitializeContext)
            }
            context = ctx
            isLoaded = true
            loadedModelURL = url
            return .success(())
        }
    }

    public func unload() {
        queue.sync {
            if let context { whisper_free(context) }
            context = nil
            isLoaded = false
            loadedModelURL = nil
        }
    }

    // MARK: - Transcription

    /// Transcribes Float32 PCM samples at 16 kHz. Blocking; call from a background task.
    ///
    /// - Parameters:
    ///   - samples: Mono Float32 samples in [-1, 1] at 16 kHz.
    ///   - language: ISO language code (e.g. "en", "tr") or `nil` for auto-detection.
    ///   - prompt: Previous final sentence used as decoder context (improves consistency).
    public func transcribe(samples: [Float], language: String?, prompt: String?) -> Result<TranscriptionResult, EngineError> {
        queue.sync {
            guard let ctx = context, !samples.isEmpty else {
                return .failure(isLoaded ? .transcriptionFailed : .modelNotFound)
            }

            let threads = max(1, min(8, ProcessInfo.processInfo.processorCount - 2))
            var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
            params.print_realtime = false
            params.print_progress = false
            params.print_timestamps = false
            params.print_special = false
            params.translate = false
            params.single_segment = true
            params.token_timestamps = true
            params.n_threads = Int32(threads)
            params.detect_language = (language == nil)

            return samples.withUnsafeBufferPointer { samplesPtr in
                let status = language.flatMap { lang in
                    lang.withCString { langPtr in
                        params.language = langPtr
                        if let prompt, !prompt.isEmpty {
                            return prompt.withCString { promptPtr in
                                params.initial_prompt = promptPtr
                                return whisper_full(ctx, params, samplesPtr.baseAddress, Int32(samplesPtr.count))
                            }
                        }
                        return whisper_full(ctx, params, samplesPtr.baseAddress, Int32(samplesPtr.count))
                    }
                } ?? {
                    if let prompt, !prompt.isEmpty {
                        return prompt.withCString { promptPtr in
                            params.initial_prompt = promptPtr
                            return whisper_full(ctx, params, samplesPtr.baseAddress, Int32(samplesPtr.count))
                        }
                    }
                    return whisper_full(ctx, params, samplesPtr.baseAddress, Int32(samplesPtr.count))
                }()

                guard status == 0 else { return .failure(.transcriptionFailed) }
                return .success(extractResult(from: ctx))
            }
        }
    }

    // MARK: - Result extraction

    private func extractResult(from ctx: OpaquePointer) -> TranscriptionResult {
        let segmentCount = whisper_full_n_segments(ctx)
        guard segmentCount > 0 else {
            return TranscriptionResult(text: "", language: detectedLanguage(from: ctx), words: [])
        }

        var fullText = ""
        var words: [TranscribedWord] = []

        for segment in 0..<segmentCount {
            if let text = whisper_full_get_segment_text(ctx, segment) {
                fullText += String(cString: text)
            }
            let tokenCount = whisper_full_n_tokens(ctx, segment)
            for token in 0..<tokenCount {
                guard let tokenText = whisper_full_get_token_text(ctx, segment, token) else { continue }
                let word = String(cString: tokenText).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !word.isEmpty else { continue }
                words.append(TranscribedWord(
                    text: word,
                    startMs: whisper_full_get_token_t0(ctx, segment, token),
                    endMs: whisper_full_get_token_t1(ctx, segment, token)
                ))
            }
        }

        return TranscriptionResult(
            text: fullText.trimmingCharacters(in: .whitespacesAndNewlines),
            language: detectedLanguage(from: ctx),
            words: words
        )
    }

    private func detectedLanguage(from ctx: OpaquePointer) -> String? {
        let langID = whisper_full_lang_id(ctx)
        guard let lang = whisper_lang_str(Int32(langID)) else { return nil }
        return String(cString: lang)
    }
}
