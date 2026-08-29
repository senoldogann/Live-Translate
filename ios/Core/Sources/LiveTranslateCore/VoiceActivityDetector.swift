import Foundation

/// Voice activity detection for the on-device pipeline.
///
/// Ports the energy-based fallback from `python/engine.py`
/// (`VoiceActivityDetector._energy_based_detection`) plus the frame-ratio rule of the
/// WebRTC path: a chunk counts as speech when more than `speechFrameRatio` of its
/// `frameDurationMs` frames exceed the RMS `threshold`.
public final class VoiceActivityDetector {
    /// RMS threshold above which a frame is considered voiced.
    public var threshold: Float = 0.01

    /// Frame duration used to split the buffer into analysis windows (milliseconds).
    public var frameDurationMs: Int = 30

    /// Sample rate of the incoming buffers.
    public var sampleRate: Int = 16000

    /// Minimum fraction of voiced frames required to classify the chunk as speech.
    public var speechFrameRatio: Float = 0.3

    public init(
        threshold: Float = 0.01,
        frameDurationMs: Int = 30,
        sampleRate: Int = 16000,
        speechFrameRatio: Float = 0.3
    ) {
        self.threshold = threshold
        self.frameDurationMs = frameDurationMs
        self.sampleRate = sampleRate
        self.speechFrameRatio = speechFrameRatio
    }

    /// Returns `true` when the buffer is likely to contain speech.
    public func isSpeech(_ samples: [Float]) -> Bool {
        let frameSize = Int(Double(sampleRate) * Double(frameDurationMs) / 1000.0)
        guard frameSize > 0, samples.count >= frameSize else {
            // Not enough for a single frame — fall back to whole-buffer energy.
            return PCMUtils.rms(samples) > threshold
        }

        var speechFrames = 0
        var totalFrames = 0
        var offset = 0
        while offset + frameSize <= samples.count {
            let frame = Array(samples[offset..<(offset + frameSize)])
            if PCMUtils.rms(frame) > threshold {
                speechFrames += 1
            }
            totalFrames += 1
            offset += frameSize
        }
        return totalFrames > 0 && Float(speechFrames) / Float(totalFrames) > speechFrameRatio
    }
}
