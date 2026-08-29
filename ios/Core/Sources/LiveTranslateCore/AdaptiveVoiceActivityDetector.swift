import Foundation

/// Energy-based VAD whose threshold adapts to the ambient noise floor.
///
/// The fixed-threshold detector (see `VoiceActivityDetector`) uses a constant
/// RMS cutoff (0.01). On a quiet microphone or in a very quiet room the mic
/// level can sit below that cutoff, so real speech is rejected and the
/// pipeline shows "listening" with no subtitles. This detector:
///
/// 1. Estimates the noise floor as the **25th percentile of recent frame RMS**
///    (a sliding window of the last ~1 second). The percentile is robust:
///    speech spikes don't drag it up, and a loud room lifts it correctly.
/// 2. Sets the speech threshold relative to that floor
///    (`max(minThreshold, noiseFloor * snrMargin)`), so it follows the room
///    in both directions.
/// 3. Applies a hangover period after the last voiced frame, so word endings
///    and short pauses inside a sentence are not chopped.
///
/// Deterministic and unit-testable with synthetic signals.
public final class AdaptiveVoiceActivityDetector {
    /// Absolute floor for the threshold (never detect below this).
    public var minThreshold: Float = 0.005

    /// How many times above the noise floor a frame must be to count as voiced.
    public var snrMargin: Float = 3.0

    /// Frame duration used to split the buffer (milliseconds).
    public var frameDurationMs: Int = 30

    /// Sample rate of the incoming buffers.
    public var sampleRate: Int = 16000

    /// Minimum fraction of voiced frames required to classify the chunk as speech.
    public var speechFrameRatio: Float = 0.3

    /// Hangover (seconds): treat frames as voiced shortly after the last
    /// voiced frame, so inter-word gaps don't cut a sentence.
    public var hangoverSeconds: Float = 0.3

    /// Number of recent frame-RMS values kept for the noise-floor percentile.
    /// At 30 ms frames this is ~0.9 s of audio.
    public var historySize: Int = 30

    /// Percentile (0–100) of recent RMS used as the noise floor.
    public var noisePercentile: Float = 25

    private var rmsHistory: [Float] = []
    private var lastVoicedTime: Date?
    private let clock: () -> Date

    public init(clock: @escaping () -> Date = Date.init) {
        self.clock = clock
    }

    /// Current noise-floor estimate (RMS, 25th percentile of recent frames).
    public var noiseFloor: Float {
        guard !rmsHistory.isEmpty else { return minThreshold }
        let sorted = rmsHistory.sorted()
        let index = max(0, min(sorted.count - 1, Int((Float(sorted.count) * noisePercentile / 100).rounded()) - 1))
        return sorted[index]
    }

    /// Current effective speech threshold (derived from `noiseFloor`).
    public var currentThreshold: Float {
        max(minThreshold, noiseFloor * snrMargin)
    }

    /// Returns `true` when the buffer is likely to contain speech.
    public func isSpeech(_ samples: [Float]) -> Bool {
        let frameSize = Int(Double(sampleRate) * Double(frameDurationMs) / 1000.0)
        guard frameSize > 0, samples.count >= frameSize else {
            // Not enough for a single frame — use whole-buffer energy with the
            // current adaptive threshold.
            let rms = PCMUtils.rms(samples)
            record(rms)
            return rms > currentThreshold
        }

        var speechFrames = 0
        var totalFrames = 0
        let threshold = currentThreshold
        var offset = 0
        while offset + frameSize <= samples.count {
            let frame = Array(samples[offset..<(offset + frameSize)])
            let rms = PCMUtils.rms(frame)
            let now = clock()

            // Hangover: a frame counts as voiced if we are still inside the
            // hangover window after the last voiced frame.
            let inHangover = lastVoicedTime.map { now.timeIntervalSince($0) < Double(hangoverSeconds) } ?? false
            if rms > threshold || inHangover {
                speechFrames += 1
                if rms > threshold {
                    lastVoicedTime = now
                }
            }
            record(rms)
            totalFrames += 1
            offset += frameSize
        }
        return totalFrames > 0 && Float(speechFrames) / Float(totalFrames) > speechFrameRatio
    }

    public func reset() {
        rmsHistory.removeAll()
        lastVoicedTime = nil
    }

    // MARK: - Noise estimation

    private func record(_ rms: Float) {
        rmsHistory.append(rms)
        if rmsHistory.count > historySize {
            rmsHistory.removeFirst(rmsHistory.count - historySize)
        }
    }
}
