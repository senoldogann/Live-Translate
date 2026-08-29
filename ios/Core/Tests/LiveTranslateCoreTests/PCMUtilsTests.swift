import XCTest
@testable import LiveTranslateCore

final class PCMUtilsTests: XCTestCase {

    func testToMonoPassthroughForMono() {
        let samples: [Float] = [0.1, -0.2, 0.3]
        XCTAssertEqual(PCMUtils.toMono(samples: samples, channels: 1), samples)
    }

    func testToMonoAveragesChannels() {
        // Stereo interleaved: L/R/L/R
        let samples: [Float] = [0.2, 0.4, -0.2, -0.4, 0.0, 0.0]
        let mono = PCMUtils.toMono(samples: samples, channels: 2)
        XCTAssertEqual(mono.count, 3)
        XCTAssertEqual(mono[0], 0.3, accuracy: 0.0001)
        XCTAssertEqual(mono[1], -0.3, accuracy: 0.0001)
        XCTAssertEqual(mono[2], 0.0, accuracy: 0.0001)
    }

    func testResampleKeepsDuration() {
        // 48000 Hz → 16000 Hz: 1/3 of the samples.
        let input = [Float](repeating: 0.5, count: 48000)
        let out = PCMUtils.resample(samples: input, from: 48000, to: 16000)
        XCTAssertEqual(out.count, 16000)
    }

    func testResampleSameRatePassthrough() {
        let input: [Float] = [0.1, 0.2, 0.3]
        XCTAssertEqual(PCMUtils.resample(samples: input, from: 16000, to: 16000), input)
    }

    func testResampleConstantSignalIsPreserved() {
        let input = [Float](repeating: 0.25, count: 4800)
        let out = PCMUtils.resample(samples: input, from: 48000, to: 16000)
        for s in out {
            XCTAssertEqual(s, 0.25, accuracy: 0.0001)
        }
    }

    func testRMSOfSilenceIsZero() {
        XCTAssertEqual(PCMUtils.rms([Float](repeating: 0, count: 100)), 0, accuracy: 0.0001)
        XCTAssertEqual(PCMUtils.rms([]), 0, accuracy: 0.0001)
    }

    func testRMSOfConstantSignal() {
        // RMS of constant 0.5 = 0.5
        XCTAssertEqual(PCMUtils.rms([Float](repeating: 0.5, count: 64)), 0.5, accuracy: 0.0001)
    }

    func testInt16ToFloatConversion() {
        let samples: [Int16] = [0, 32767, -32768, 16384]
        let floats = PCMUtils.int16ToFloat(samples)
        XCTAssertEqual(floats[0], 0.0, accuracy: 0.0001)
        XCTAssertEqual(floats[1], 0.9999, accuracy: 0.001)
        XCTAssertEqual(floats[2], -1.0, accuracy: 0.001)
        XCTAssertEqual(floats[3], 0.5, accuracy: 0.001)
    }
}
