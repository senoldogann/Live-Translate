import Foundation

/// Timing decisions for the streaming transcription loop.
///
/// The macOS engine (`python/engine.py` `_process_loop`) re-transcribes the
/// speech buffer on a fixed cadence and finalizes on silence or a max-duration
/// timeout. This type ports those rules into a pure, deterministic form so the
/// decision logic is unit-testable without a Whisper model.
///
/// Rules:
/// - Below the minimum audio duration: skip.
/// - Silence elapsed (>= `silenceThreshold`) or buffer longer than
///   `maxSegmentDuration`: final pass over the whole buffer.
/// - Otherwise a partial pass over the tail window — but only when at least
///   `minNewAudioInterval` of new speech arrived since the last pass **and** the
///   `processingInterval` minimum cadence elapsed. Re-transcribing an unchanged
///   tail window wastes CPU/battery and yields the same text.
public struct TranscriptionScheduler {
    public var sampleRate: Int = 16000
    public var minAudioDuration: TimeInterval = 0.2
    public var silenceThreshold: TimeInterval = 0.35
    public var maxSegmentDuration: TimeInterval = 6.0
    public var processingInterval: TimeInterval = 0.2
    public var partialWindow: TimeInterval = 5.0
    /// Minimum new audio (seconds) before a partial pass is worth re-running.
    public var minNewAudioInterval: TimeInterval = 0.5

    public init(
        sampleRate: Int = 16000,
        minAudioDuration: TimeInterval = 0.2,
        silenceThreshold: TimeInterval = 0.35,
        maxSegmentDuration: TimeInterval = 6.0,
        processingInterval: TimeInterval = 0.2,
        partialWindow: TimeInterval = 5.0,
        minNewAudioInterval: TimeInterval = 0.5
    ) {
        self.sampleRate = sampleRate
        self.minAudioDuration = minAudioDuration
        self.silenceThreshold = silenceThreshold
        self.maxSegmentDuration = maxSegmentDuration
        self.processingInterval = processingInterval
        self.partialWindow = partialWindow
        self.minNewAudioInterval = minNewAudioInterval
    }

    /// Decide what to do with the current speech buffer.
    ///
    /// - Parameters:
    ///   - now: Current time.
    ///   - bufferLength: Samples currently in the speech buffer.
    ///   - lastProcessedLength: Buffer length at the last transcription pass
    ///     (reset to 0 when the buffer is cleared).
    ///   - lastSpeech: Time of the last voiced frame (`nil` if none yet).
    ///   - lastTranscript: Time of the last transcription pass that published.
    public func decide(
        now: Date,
        bufferLength: Int,
        lastProcessedLength: Int,
        lastSpeech: Date?,
        lastTranscript: Date
    ) -> TranscriptionDecision {
        let duration = Double(bufferLength) / Double(sampleRate)
        guard duration >= minAudioDuration else {
            return TranscriptionDecision(kind: .skip, sampleCount: 0, isTimeoutCut: false)
        }

        let isSilenceFinal = lastSpeech.map { now.timeIntervalSince($0) >= silenceThreshold } ?? false
        let isTimeoutFinal = duration > maxSegmentDuration
        if isSilenceFinal || isTimeoutFinal {
            return TranscriptionDecision(kind: .final, sampleCount: bufferLength, isTimeoutCut: isTimeoutFinal)
        }

        // Partial cadence: minimum interval plus enough new speech to change the tail.
        guard now.timeIntervalSince(lastTranscript) >= processingInterval else {
            return TranscriptionDecision(kind: .skip, sampleCount: 0, isTimeoutCut: false)
        }
        let newSamples = bufferLength - lastProcessedLength
        let minNewSamples = Int(Double(sampleRate) * minNewAudioInterval)
        guard newSamples >= minNewSamples else {
            return TranscriptionDecision(kind: .skip, sampleCount: 0, isTimeoutCut: false)
        }

        let maxPartial = Int(Double(sampleRate) * partialWindow)
        return TranscriptionDecision(kind: .partial, sampleCount: min(bufferLength, maxPartial), isTimeoutCut: false)
    }
}

/// One decision from `TranscriptionScheduler`.
public struct TranscriptionDecision: Equatable {
    public enum Kind: Equatable {
        case skip
        case partial
        case final
    }

    public let kind: Kind
    /// Samples to transcribe: the tail window for `.partial`, the full buffer
    /// for `.final`, and 0 for `.skip`. `buffer.suffix(sampleCount)` produces
    /// the full buffer when `sampleCount == bufferLength`.
    public let sampleCount: Int
    /// True when `.final` was forced by the max-duration timeout rather than silence.
    public let isTimeoutCut: Bool

    public init(kind: Kind, sampleCount: Int, isTimeoutCut: Bool) {
        self.kind = kind
        self.sampleCount = sampleCount
        self.isTimeoutCut = isTimeoutCut
    }
}
