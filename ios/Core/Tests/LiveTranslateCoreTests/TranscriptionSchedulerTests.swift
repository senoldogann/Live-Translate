import XCTest
@testable import LiveTranslateCore

final class TranscriptionSchedulerTests: XCTestCase {
    private let scheduler = TranscriptionScheduler()
    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    private func samples(_ seconds: TimeInterval) -> Int {
        Int(Double(scheduler.sampleRate) * seconds)
    }

    private func decide(
        bufferLength: Int,
        lastProcessed: Int = 0,
        lastSpeech: Date?,
        lastTranscript: Date,
        now: Date? = nil
    ) -> TranscriptionDecision {
        scheduler.decide(
            now: now ?? t0,
            bufferLength: bufferLength,
            lastProcessedLength: lastProcessed,
            lastSpeech: lastSpeech,
            lastTranscript: lastTranscript
        )
    }

    func testSkipBelowMinimumDuration() {
        let d = decide(bufferLength: samples(0.1), lastSpeech: t0, lastTranscript: .distantPast)
        XCTAssertEqual(d.kind, .skip)
        XCTAssertEqual(d.sampleCount, 0)
    }

    func testFirstPartialFiresWhenEnoughAudio() {
        let d = decide(bufferLength: samples(1), lastSpeech: t0, lastTranscript: .distantPast)
        XCTAssertEqual(d.kind, .partial)
    }

    func testPartialAfterEnoughNewAudio() {
        let d = decide(
            bufferLength: samples(2),
            lastProcessed: samples(1),
            lastSpeech: t0,
            lastTranscript: t0.addingTimeInterval(-0.5)
        )
        XCTAssertEqual(d.kind, .partial)
    }

    func testSkipPartialWhenTailUnchanged() {
        // No new audio since the last pass → same tail window → skip.
        let d = decide(
            bufferLength: samples(2),
            lastProcessed: samples(2),
            lastSpeech: t0,
            lastTranscript: t0.addingTimeInterval(-0.5)
        )
        XCTAssertEqual(d.kind, .skip)
    }

    func testSkipPartialWithTooLittleNewAudio() {
        // Only 0.3s of new audio (< minNewAudioInterval 0.5s).
        let d = decide(
            bufferLength: samples(1.3),
            lastProcessed: samples(1),
            lastSpeech: t0,
            lastTranscript: t0.addingTimeInterval(-0.5)
        )
        XCTAssertEqual(d.kind, .skip)
    }

    func testSkipPartialInsideProcessingInterval() {
        let d = decide(
            bufferLength: samples(2),
            lastProcessed: 0,
            lastSpeech: t0,
            lastTranscript: t0.addingTimeInterval(-0.1)
        )
        XCTAssertEqual(d.kind, .skip)
    }

    func testFinalOnSilence() {
        // Silence elapsed (0.5s > 0.35s) even though new audio accumulated.
        let d = decide(
            bufferLength: samples(2),
            lastProcessed: samples(1),
            lastSpeech: t0.addingTimeInterval(-0.5),
            lastTranscript: t0.addingTimeInterval(-1)
        )
        XCTAssertEqual(d.kind, .final)
        XCTAssertEqual(d.sampleCount, samples(2))
        XCTAssertFalse(d.isTimeoutCut)
    }

    func testFinalOnTimeout() {
        let d = decide(
            bufferLength: samples(7),
            lastProcessed: samples(6.5),
            lastSpeech: t0,
            lastTranscript: t0.addingTimeInterval(-1)
        )
        XCTAssertEqual(d.kind, .final)
        XCTAssertEqual(d.sampleCount, samples(7))
        XCTAssertTrue(d.isTimeoutCut)
    }

    func testFinalWinsOverPartial() {
        let d = decide(
            bufferLength: samples(3),
            lastProcessed: samples(2),
            lastSpeech: t0.addingTimeInterval(-0.4),
            lastTranscript: t0.addingTimeInterval(-1)
        )
        XCTAssertEqual(d.kind, .final)
    }

    func testPartialWindowCapsSampleCount() {
        // 6s buffer, 5s partial window → tail of 5s.
        let d = decide(
            bufferLength: samples(6),
            lastProcessed: samples(5),
            lastSpeech: t0,
            lastTranscript: t0.addingTimeInterval(-1)
        )
        XCTAssertEqual(d.kind, .partial)
        XCTAssertEqual(d.sampleCount, samples(5))
    }

    func testResumeAfterBufferCleared() {
        // Buffer was cleared after a final (lastProcessed = 0); once enough new
        // speech accumulates, partials fire again.
        let d = decide(
            bufferLength: samples(1),
            lastProcessed: 0,
            lastSpeech: t0,
            lastTranscript: t0.addingTimeInterval(-0.5)
        )
        XCTAssertEqual(d.kind, .partial)
    }
}
