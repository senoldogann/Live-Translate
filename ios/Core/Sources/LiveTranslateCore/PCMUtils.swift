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
}
