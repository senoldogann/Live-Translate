import XCTest
@testable import LiveTranslateCore

final class AdaptiveVoiceActivityDetectorTests: XCTestCase {
    private let sampleRate = 16000

    private func noise(rms: Float, frames: Int = 1) -> [Float] {
        // Deterministic low-amplitude noise with a target RMS.
        var out: [Float] = []
        var seed: UInt64 = 12345
        for _ in 0..<(frames * 480) {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            let value = Float((seed >> 33) & 0xFFFF) / Float(0xFFFF) * 2 - 1
            out.append(value * rms * 1.7)
        }
        return out
    }

    private func tone(rms: Float, frames: Int = 1) -> [Float] {
        var out: [Float] = []
        for frame in 0..<(frames * 480) {
            out.append(sin(Float(frame) * 0.1) * rms * 1.4)
        }
        return out
    }

    private func makeVAD(clock: @escaping () -> Date = Date.init) -> AdaptiveVoiceActivityDetector {
        let vad = AdaptiveVoiceActivityDetector(clock: clock)
        vad.sampleRate = sampleRate
        return vad
    }

    func testDetectsSpeechAboveNoise() {
        let vad = makeVAD()
        // Calm noise floor first.
        XCTAssertFalse(vad.isSpeech(noise(rms: 0.003)))
        XCTAssertTrue(vad.isSpeech(tone(rms: 0.05)))
    }

    func testThresholdAdaptsToQuietRoom() {
        let vad = makeVAD()
        // Feed several quiet-noise chunks — the noise floor should settle low.
        for _ in 0..<20 {
            _ = vad.isSpeech(noise(rms: 0.003))
        }
        XCTAssertLessThan(vad.noiseFloor, 0.004)
        // Threshold should drop below the old fixed 0.01 cutoff.
        XCTAssertLessThan(vad.currentThreshold, 0.01)
        // Speech well above the noise is still detected.
        XCTAssertTrue(vad.isSpeech(tone(rms: 0.03)))
    }

    func testRaisesThresholdInNoisyRoom() {
        var now = Date(timeIntervalSince1970: 1000)
        let vad = makeVAD(clock: { now })
        // Constant background noise → threshold rises above the fixed 0.01.
        for _ in 0..<60 {
            _ = vad.isSpeech(noise(rms: 0.02))
            now += 0.1 // 30 ms per frame; space the chunks out
        }
        XCTAssertGreaterThan(vad.noiseFloor, 0.01)
        XCTAssertGreaterThan(vad.currentThreshold, 0.03)
        // Past any hangover: speech barely above noise is rejected.
        now += 1.0
        XCTAssertFalse(vad.isSpeech(tone(rms: 0.01)))
    }

    func testHangoverKeepsShortPauses() {
        var now = Date(timeIntervalSince1970: 1000)
        let vad = makeVAD(clock: { now })
        // Voiced chunk.
        XCTAssertTrue(vad.isSpeech(tone(rms: 0.05)))
        // A quiet chunk within the hangover window still counts as voiced.
        now += 0.2 // < hangoverSeconds
        XCTAssertTrue(vad.isSpeech(noise(rms: 0.003)))
        // After the hangover expires, quiet is rejected.
        now += 1.0
        XCTAssertFalse(vad.isSpeech(noise(rms: 0.003)))
    }

    func testReset() {
        let vad = makeVAD()
        for _ in 0..<40 {
            _ = vad.isSpeech(noise(rms: 0.02))
        }
        XCTAssertGreaterThan(vad.noiseFloor, 0.01)
        vad.reset()
        XCTAssertEqual(vad.noiseFloor, vad.minThreshold)
    }

    func testSpeechSpikeDoesNotPermanentlyRaiseNoiseFloor() {
        let vad = makeVAD()
        for _ in 0..<20 {
            _ = vad.isSpeech(noise(rms: 0.003))
        }
        let before = vad.noiseFloor
        // A loud speech burst.
        _ = vad.isSpeech(tone(rms: 0.2))
        // After the burst, quiet again — the percentile stays near the noise.
        for _ in 0..<30 {
            _ = vad.isSpeech(noise(rms: 0.003))
        }
        XCTAssertLessThan(vad.noiseFloor, before * 4 + 0.002)
        XCTAssertLessThan(vad.currentThreshold, 0.03)
    }
}
