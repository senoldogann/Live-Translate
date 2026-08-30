import Foundation
import LiveTranslateCore

// MARK: - Injection protocols
//
// The pipeline only depends on these narrow protocols, so tests can drive it
// with fakes (no microphone, no whisper.cpp, no Live Activities, no model
// downloads). The concrete types live in the app and conform below.

/// Speech-to-text engine (whisper.cpp wrapper conforms). The concrete error
/// type is used so `DispatchQueue.sync` overload resolution stays unambiguous.
protocol STTTranscribing: AnyObject {
    func loadModel(at url: URL) -> Result<Void, STTEngine.EngineError>
    func transcribe(
        samples: [Float],
        language: String?,
        prompt: String?,
        detectLanguage: Bool
    ) -> Result<TranscriptionResult, STTEngine.EngineError>
    func unload()
}

/// Audio capture session delivering mono Float32 chunks at 16 kHz.
protocol AudioSessioning: AnyObject {
    var onAudioChunk: (([Float]) -> Void)? { get set }
    func start() throws
    func stop()
}

/// Locates and downloads the local Whisper model.
protocol ModelLocating {
    func localURL(for option: AppSettings.WhisperModelOption) -> URL?
    func download(_ option: AppSettings.WhisperModelOption)
}

/// Lock Screen / Dynamic Island Live Activity lifecycle.
protocol LiveActivityManaging {
    func start(sourceLanguage: String, targetLanguage: String) async
    func update(original: String, translated: String, isFinal: Bool) async
    func end() async
}

// MARK: - Concrete conformance

extension STTEngine: STTTranscribing {}

extension AudioSessionManager: AudioSessioning {}

extension ModelManager: ModelLocating {}

extension LiveActivityManager: LiveActivityManaging {}

// MARK: - Dependency container

/// Everything the pipeline needs to run. `.live` wires the real implementations;
/// tests substitute fakes.
struct PipelineDependencies {
    var makeSTT: () -> STTTranscribing
    var requestPermission: () async -> Bool
    var makeAudio: () throws -> AudioSessioning
    var modelLocator: ModelLocating
    var liveActivity: LiveActivityManaging

    static var live: PipelineDependencies {
        PipelineDependencies(
            makeSTT: { STTEngine() },
            requestPermission: { await AudioSessionManager.requestPermission() },
            makeAudio: { try AudioSessionManager() },
            modelLocator: ModelManager.shared,
            liveActivity: LiveActivityManager.shared
        )
    }
}
