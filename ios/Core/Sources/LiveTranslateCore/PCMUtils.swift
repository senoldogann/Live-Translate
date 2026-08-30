import Foundation

/// Pure PCM audio helpers. All functions are deterministic and testable without audio hardware.
public enum PCMUtils {
    /// Down-mix interleaved multi-channel Float32 samples to mono by averaging channels.
    ///
    /// - Parameters:
    ///   - samples: Interleaved samples (`channels` per frame).
    ///   - channels: Number of interleaved channels. `1` returns the input unchanged.
    public static func toMono(samples: [Float], channels: Int) -> [Float] {
        guard channels > 1 else { return samples }
        let frames = samples.count / channels
        var mono = [Float](repeating: 0, count: frames)
        for frame in 0..<frames {
            var sum: Float = 0
            for channel in 0..<channels {
                sum += samples[frame * channels + channel]
            }
            mono[frame] = sum / Float(channels)
        }
        return mono
    }

    /// Resample Float32 samples from `inputRate` to `outputRate` using linear interpolation.
    /// Sufficient for speech (e.g. 48 kHz microphone → 16 kHz Whisper input).
    public static func resample(samples: [Float], from inputRate: Double, to outputRate: Double) -> [Float] {
        guard inputRate > 0, outputRate > 0, samples.count > 1, inputRate != outputRate else {
            return samples
        }
        let ratio = inputRate / outputRate
        let outputCount = Int((Double(samples.count) / ratio).rounded(.down))
        guard outputCount > 0 else { return [] }

        var out = [Float](repeating: 0, count: outputCount)
        for i in 0..<outputCount {
            let srcPos = Double(i) * ratio
            let i0 = Int(srcPos)
            let i1 = min(i0 + 1, samples.count - 1)
            let frac = Float(srcPos - Double(i0))
            out[i] = samples[i0] * (1 - frac) + samples[i1] * frac
        }
        return out
    }

    /// Root-mean-square energy of a sample buffer.
    public static func rms(_ samples: [Float]) -> Float {
        guard !samples.isEmpty else { return 0 }
        var sum: Float = 0
        for s in samples { sum += s * s }
        return (sum / Float(samples.count)).squareRoot()
    }

    /// Convert 16-bit signed integer PCM to Float32 in [-1, 1].
    public static func int16ToFloat(_ samples: [Int16]) -> [Float] {
        samples.map { Float($0) / 32768.0 }
    }

    // MARK: - Raw PCM decoding (CMSampleBuffer audio → Float32 mono)

    /// Decodes one channel of raw little-endian PCM bytes into Float32 in [-1, 1].
    ///
    /// Supports the formats ReplayKit / AVAudioEngine commonly emit:
    /// - Float32 (4 bytes), Float64 (8 bytes)
    /// - Int16 (2), Int32 (4), Int24 (3), Int8 (1)
    /// - unsigned Int8/Int16/Int32
    ///
    /// The converter in the Broadcast Extension feeds the per-channel byte slices
    /// from a `CMSampleBuffer` here so all format handling stays pure, deterministic
    /// and unit-testable (no audio hardware required).
    public static func decodeChannel(
        bytes: [UInt8],
        bytesPerSample: Int,
        isFloat: Bool,
        isSigned: Bool
    ) -> [Float] {
        let bps = max(1, bytesPerSample)
        let count = bytes.count / bps
        guard count > 0 else { return [] }

        var out = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let base = i * bps
            out[i] = decodeOneSample(
                bytes: bytes, offset: base, bytesPerSample: bps,
                isFloat: isFloat, isSigned: isSigned
            )
        }
        return out
    }

    /// Averages a list of per-channel Float32 arrays into a mono buffer.
    /// Returns the input unchanged when there is only one channel.
    public static func averageChannels(_ channels: [[Float]]) -> [Float] {
        guard let first = channels.first else { return [] }
        guard channels.count > 1 else { return first }
        let frames = first.count
        var mono = [Float](repeating: 0, count: frames)
        let n = Float(channels.count)
        for channel in channels {
            guard channel.count == frames else { continue }
            for f in 0..<frames { mono[f] += channel[f] / n }
        }
        return mono
    }

    // MARK: - Private

    private static func decodeOneSample(
        bytes: [UInt8],
        offset: Int,
        bytesPerSample: Int,
        isFloat: Bool,
        isSigned: Bool
    ) -> Float {
        if isFloat {
            return decodeFloat(bytes: bytes, offset: offset, bytesPerSample: bytesPerSample)
        }
        return decodeInt(bytes: bytes, offset: offset, bytesPerSample: bytesPerSample, isSigned: isSigned)
    }

    private static func decodeFloat(bytes: [UInt8], offset: Int, bytesPerSample: Int) -> Float {
        switch bytesPerSample {
        case 4:
            let bits = UInt32(bytes[offset])
                | UInt32(bytes[offset + 1]) << 8
                | UInt32(bytes[offset + 2]) << 16
                | UInt32(bytes[offset + 3]) << 24
            return Float(bitPattern: bits)
        case 8:
            var v = Double.zero
            bytes.withUnsafeBufferPointer { buf in
                _ = memcpy(&v, buf.baseAddress!.advanced(by: offset), 8)
            }
            return Float(v)
        default:
            return 0
        }
    }

    private static func decodeInt(bytes: [UInt8], offset: Int, bytesPerSample: Int, isSigned: Bool) -> Float {
        var value: Int64 = 0
        var unsignedValue: UInt64 = 0
        switch bytesPerSample {
        case 1:
            unsignedValue = UInt64(bytes[offset])
            if isSigned { value = Int64(Int8(bitPattern: bytes[offset])) }
        case 2:
            let combined = UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
            unsignedValue = UInt64(combined)
            if isSigned { value = Int64(Int16(bitPattern: combined)) }
        case 3:
            unsignedValue = UInt64(bytes[offset])
                | UInt64(bytes[offset + 1]) << 8
                | UInt64(bytes[offset + 2]) << 16
            if isSigned && unsignedValue & 0x80_0000 != 0 {
                unsignedValue |= 0xFF_00_00_00
                value = Int64(bitPattern: unsignedValue)
            }
        case 4:
            let combined = UInt32(bytes[offset])
                | UInt32(bytes[offset + 1]) << 8
                | UInt32(bytes[offset + 2]) << 16
                | UInt32(bytes[offset + 3]) << 24
            unsignedValue = UInt64(combined)
            if isSigned { value = Int64(Int32(bitPattern: combined)) }
        default:
            return 0
        }

        if isSigned {
            let maxV = Float(Int64(1) << (8 * bytesPerSample - 1))
            return Float(value) / maxV
        }
        let maxV = Float(Int64(1) << (8 * bytesPerSample))
        return Float(unsignedValue) / maxV
    }
}
