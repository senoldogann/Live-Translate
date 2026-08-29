import XCTest
@testable import LiveTranslateCore

final class VoiceActivityDetectorTests: XCTestCase {

    func testSilenceIsNotSpeech() {
        let vad = VoiceActivityDetector()
        let silence = [Float](repeating: 0.0, count: 1600) // 100ms @16k
        XCTAssertFalse(vad.isSpeech(silence))
    }

    func testLoudSignalIsSpeech() {
        let vad = VoiceActivityDetector()
        let loud = [Float](repeating: 0.5, count: 1600)
        XCTAssertTrue(vad.isSpeech(loud))
    }

    func testShortBufferFallsBackToEnergy() {
        let vad = VoiceActivityDetector()
        // 10 samples only — below one 30ms frame (480 @16k).
        let quiet = [Float](repeating: 0.001, count: 10)
        XCTAssertFalse(vad.isSpeech(quiet))
        let loud = [Float](repeating: 0.9, count: 10)
        XCTAssertTrue(vad.isSpeech(loud))
    }

    func testSparseSpeechBelowRatioIsNotSpeech() {
        let vad = VoiceActivityDetector()
        vad.speechFrameRatio = 0.3
        // 10 frames total, only 2 loud → 20% < 30%.
        var samples: [Float] = []
        for i in 0..<10 {
            samples.append(contentsOf: [Float](repeating: i < 2 ? 0.9 : 0.0, count: 480))
        }
        XCTAssertFalse(vad.isSpeech(samples))
    }

    func testDenseSpeechAboveRatioIsSpeech() {
        let vad = VoiceActivityDetector()
        vad.speechFrameRatio = 0.3
        // 5 of 10 frames loud → 50% > 30%.
        var samples: [Float] = []
        for i in 0..<10 {
            samples.append(contentsOf: [Float](repeating: i < 5 ? 0.9 : 0.0, count: 480))
        }
        XCTAssertTrue(vad.isSpeech(samples))
    }

    func testCustomThreshold() {
        let vad = VoiceActivityDetector(threshold: 0.5)
        let medium = [Float](repeating: 0.3, count: 1600)
        XCTAssertFalse(vad.isSpeech(medium))
    }
}
