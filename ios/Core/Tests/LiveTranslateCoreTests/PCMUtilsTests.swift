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

    // MARK: - decodeChannel (raw PCM → Float32)

    private func floatBytes(_ values: [Float]) -> [UInt8] {
        values.flatMap { v -> [UInt8] in
            let bits = v.bitPattern
            return [UInt8(bits & 0xFF), UInt8((bits >> 8) & 0xFF), UInt8((bits >> 16) & 0xFF), UInt8((bits >> 24) & 0xFF)]
        }
    }

    func testDecodeChannelFloat32() {
        let floats: [Float] = [0.5, -1.0, 0.25]
        let out = PCMUtils.decodeChannel(bytes: floatBytes(floats), bytesPerSample: 4, isFloat: true, isSigned: true)
        XCTAssertEqual(out.count, 3)
        XCTAssertEqual(out[0], 0.5, accuracy: 0.0001)
        XCTAssertEqual(out[1], -1.0, accuracy: 0.0001)
        XCTAssertEqual(out[2], 0.25, accuracy: 0.0001)
    }

    func testDecodeChannelInt16Signed() {
        // 32767 → ~0.99997, -32768 → -1.0, 16384 → 0.5
        var bytes: [UInt8] = []
        let add = { (v: Int16) in
            bytes.append(UInt8(truncatingIfNeeded: v))
            bytes.append(UInt8(truncatingIfNeeded: v >> 8))
        }
        add(32767); add(-32768); add(16384)
        let out = PCMUtils.decodeChannel(bytes: bytes, bytesPerSample: 2, isFloat: false, isSigned: true)
        XCTAssertEqual(out.count, 3)
        XCTAssertEqual(out[0], 0.9999, accuracy: 0.001)
        XCTAssertEqual(out[1], -1.0, accuracy: 0.001)
        XCTAssertEqual(out[2], 0.5, accuracy: 0.001)
    }

    func testDecodeChannelUnsignedUInt8() {
        // Unsigned 0..255 → [0,1]; 128 → ~0.502
        let bytes: [UInt8] = [0, 128, 255]
        let out = PCMUtils.decodeChannel(bytes: bytes, bytesPerSample: 1, isFloat: false, isSigned: false)
        XCTAssertEqual(out.count, 3)
        XCTAssertEqual(out[0], 0.0, accuracy: 0.0001)
        XCTAssertEqual(out[1], 0.5, accuracy: 0.001)
        XCTAssertEqual(out[2], 255.0 / 256.0, accuracy: 0.001)
    }

    func testDecodeChannelPartialBytesIgnored() {
        // 5 bytes with 2-byte samples → only 2 samples decoded.
        let bytes: [UInt8] = [0x00, 0x00, 0x00, 0x00, 0xFF]
        XCTAssertEqual(PCMUtils.decodeChannel(bytes: bytes, bytesPerSample: 2, isFloat: false, isSigned: true).count, 2)
    }

    // MARK: - averageChannels

    func testAverageChannelsMonoPassthrough() {
        let ch: [[Float]] = [[0.1, 0.2]]
        XCTAssertEqual(PCMUtils.averageChannels(ch), [0.1, 0.2])
    }

    func testAverageChannelsAveragesStereo() {
        let ch: [[Float]] = [[0.2, -0.2], [0.4, -0.4]]
        let mono = PCMUtils.averageChannels(ch)
        XCTAssertEqual(mono.count, 2)
        XCTAssertEqual(mono[0], 0.3, accuracy: 0.0001)
        XCTAssertEqual(mono[1], -0.3, accuracy: 0.0001)
    }

    func testAverageChannelsEmpty() {
        XCTAssertTrue(PCMUtils.averageChannels([]).isEmpty)
    }

    // MARK: - Exact regression for the broadcast crash

    /// The reported failure: the very first chunk converted, every later chunk
    /// produced zero output (`noMono`). This is a stateless decode+resample; it
    /// MUST yield output for every fed frame, chunk after chunk.
    func testStatelessPipelineProducesOutputForEveryChunk() {
        for chunk in 1...50 {
            let stereoFloats: [Float] = [0.1, 0.1, -0.1, -0.1, 0.3, 0.3]  // 3 frames stereo interleaved
            let l = PCMUtils.decodeChannel(bytes: stride(from: 0, to: stereoFloats.count, by: 2).flatMap { i in
                let v = stereoFloats[i]; let bits = v.bitPattern
                return [UInt8(bits & 0xFF), UInt8((bits >> 8) & 0xFF), UInt8((bits >> 16) & 0xFF), UInt8((bits >> 24) & 0xFF)]
            }, bytesPerSample: 4, isFloat: true, isSigned: true)
            let r = PCMUtils.decodeChannel(bytes: stride(from: 1, to: stereoFloats.count, by: 2).flatMap { i in
                let v = stereoFloats[i]; let bits = v.bitPattern
                return [UInt8(bits & 0xFF), UInt8((bits >> 8) & 0xFF), UInt8((bits >> 16) & 0xFF), UInt8((bits >> 24) & 0xFF)]
            }, bytesPerSample: 4, isFloat: true, isSigned: true)
            let mono = PCMUtils.averageChannels([l, r])
            let resampled = PCMUtils.resample(samples: mono, from: 48000, to: 16000)
            XCTAssertFalse(resampled.isEmpty, "chunk \(chunk)")
        }
    }
}
