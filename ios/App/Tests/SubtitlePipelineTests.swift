import XCTest
import LiveTranslateCore
@testable import Stealth_Subtitle_Translator

// MARK: - Fakes

private final class FakeSTT: STTTranscribing {
    var loadResult: Result<Void, STTEngine.EngineError> = .success(())
    var nextText: String = "Merhaba dünya."
    var detectedLanguage: String? = "tr"
    /// When set, always returned as the detected language (overrides both the
    /// passed language and `detectedLanguage`) — used for mismatch scenarios.
    var forcedLanguage: String?
    var loadCallCount = 0
    var transcribeCalls: [(sampleCount: Int, language: String?, detectLanguage: Bool)] = []

    func loadModel(at url: URL) -> Result<Void, STTEngine.EngineError> {
        loadCallCount += 1
        return loadResult
    }

    func transcribe(
        samples: [Float],
        language: String?,
        prompt: String?,
        detectLanguage: Bool
    ) -> Result<TranscriptionResult, STTEngine.EngineError> {
        transcribeCalls.append((samples.count, language, detectLanguage))
        return .success(TranscriptionResult(
            text: nextText,
            language: forcedLanguage ?? language ?? detectedLanguage,
            words: []
        ))
    }

    func unload() {}
}

private final class FakeAudio: AudioSessioning {
    var onAudioChunk: (([Float]) -> Void)?
    var startError: Error?
    var startCallCount = 0
    var stopCallCount = 0

    func start() throws {
        startCallCount += 1
        if let startError { throw startError }
    }

    func stop() {
        stopCallCount += 1
    }

    func emit(_ chunk: [Float]) {
        onAudioChunk?(chunk)
    }
}

private final class FakeModelLocator: ModelLocating {
    var url: URL?
    var downloadCallCount = 0

    func localURL(for option: AppSettings.WhisperModelOption) -> URL? { url }

    func download(_ option: AppSettings.WhisperModelOption) {
        downloadCallCount += 1
    }
}

private final class FakeLiveActivity: LiveActivityManaging {
    var startCallCount = 0
    var updates: [(original: String, translated: String, isFinal: Bool)] = []
    var endCallCount = 0

    func start(sourceLanguage: String, targetLanguage: String) async {
        startCallCount += 1
    }

    func update(original: String, translated: String, isFinal: Bool) async {
        updates.append((original, translated, isFinal))
    }

    func end() async {
        endCallCount += 1
    }
}

// MARK: - Tests

/// Exercises the whole local pipeline (permission → model → audio → VAD →
/// buffer → scheduler → STT → assembler → model) without any hardware or the
/// whisper binary, using the injected fakes.
@MainActor
final class SubtitlePipelineTests: XCTestCase {
    private var stt: FakeSTT!
    private var audio: FakeAudio!
    private var locator: FakeModelLocator!
    private var live: FakeLiveActivity!

    override func setUp() {
        super.setUp()
        stt = FakeSTT()
        audio = FakeAudio()
        locator = FakeModelLocator()
        locator.url = URL(fileURLWithPath: "/tmp/fake-model.bin")
        live = FakeLiveActivity()
    }

    private func makePipeline(
        permission: Bool = true,
        sourceLanguage: String = "auto"
    ) -> SubtitlePipeline {
        let settings = ObservableSettings()
        settings.sourceLanguage = sourceLanguage
        let deps = PipelineDependencies(
            makeSTT: { [stt] in stt! },
            requestPermission: { permission },
            makeAudio: { [audio] in audio! },
            modelLocator: locator!,
            liveActivity: live!
        )
        return SubtitlePipeline(settings: settings, dependencies: deps)
    }

    private func speechChunk(seconds: Double = 0.6) -> [Float] {
        // Loud enough to pass the adaptive VAD's noise-relative threshold.
        [Float](repeating: 0.4, count: Int(16000 * seconds))
    }

    // MARK: Lifecycle

    func testStartFailsWhenPermissionDenied() async {
        let pipeline = makePipeline(permission: false)
        await pipeline.start()
        guard case .failed = pipeline.phase else {
            return XCTFail("expected failed phase, got \(pipeline.phase)")
        }
        XCTAssertEqual(stt.loadCallCount, 0, "STT must not load without permission")
        XCTAssertEqual(audio.startCallCount, 0)
    }

    func testStartFailsWhenModelMissing() async {
        locator.url = nil
        let pipeline = makePipeline()
        await pipeline.start()
        guard case .failed = pipeline.phase else {
            return XCTFail("expected failed phase, got \(pipeline.phase)")
        }
        XCTAssertEqual(locator.downloadCallCount, 1, "missing model must trigger a download")
    }

    func testStartLoadsModelAndStartsAudioAndActivity() async {
        let pipeline = makePipeline()
        await pipeline.start()
        XCTAssertEqual(pipeline.phase, .listening)
        XCTAssertEqual(stt.loadCallCount, 1)
        XCTAssertEqual(audio.startCallCount, 1)
        XCTAssertEqual(live.startCallCount, 1)
        pipeline.stop()
        // end() is dispatched on a fire-and-forget task — give it a beat.
        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(live.endCallCount, 1)
    }

    func testStartSurfacesAudioSetupFailure() async {
        audio.startError = FakeAudioError.setupFailed
        let pipeline = makePipeline()
        await pipeline.start()
        guard case .failed = pipeline.phase else {
            return XCTFail("expected failed phase, got \(pipeline.phase)")
        }
        XCTAssertEqual(audio.startCallCount, 1)
    }

    // MARK: Streaming

    func testSpeechProducesPartialThenFinalSegment() async throws {
        let pipeline = makePipeline()
        await pipeline.start()

        audio.emit(speechChunk()) // 0.6s of speech

        // The partial fires on the ~0.2s processing tick (min-new-audio 0.5s
        // satisfied) and is replaced by the final at ~0.4s (silence 0.35s), so
        // assert the partial before the silence window elapses.
        try await Task.sleep(nanoseconds: 350_000_000)
        XCTAssertEqual(pipeline.model.originalText, "Merhaba dünya.")
        XCTAssertFalse(pipeline.model.isFinal, "streaming text should be partial")

        // Silence finalizes after 0.35s.
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertTrue(pipeline.model.isFinal, "silence must finalize the segment")
        XCTAssertFalse(pipeline.model.history.isEmpty, "final must land in history")
        XCTAssertTrue(live.updates.contains { $0.isFinal })

        pipeline.stop()
    }

    func testLanguagePinnedAfterFirstDetection() async throws {
        stt.detectedLanguage = "en"
        let pipeline = makePipeline() // source = auto
        await pipeline.start()

        audio.emit(speechChunk())
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertGreaterThanOrEqual(stt.transcribeCalls.count, 1)

        let first = stt.transcribeCalls[0]
        XCTAssertNil(first.language, "first pass should auto-detect")
        XCTAssertTrue(first.detectLanguage, "first pass should run detection")

        // After the first non-empty result pins "en", later passes reuse it.
        try await Task.sleep(nanoseconds: 700_000_000)
        let last = stt.transcribeCalls.last!
        XCTAssertEqual(last.language, "en", "detected language must be pinned")
        XCTAssertFalse(last.detectLanguage, "detection must not run again")

        pipeline.stop()
    }

    func testLanguageMismatchSkipsSegment() async throws {
        stt.forcedLanguage = "en"
        let pipeline = makePipeline(sourceLanguage: "tr") // fixed source
        await pipeline.start()

        audio.emit(speechChunk())
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertTrue(pipeline.model.originalText.isEmpty, "mismatched language must be dropped")

        pipeline.stop()
    }

    func testEmptyTranscriptionIgnored() async throws {
        stt.nextText = ""
        let pipeline = makePipeline()
        await pipeline.start()

        audio.emit(speechChunk())
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertTrue(pipeline.model.originalText.isEmpty, "empty transcription must not publish")

        pipeline.stop()
    }
}

private enum FakeAudioError: Error {
    case setupFailed
}
