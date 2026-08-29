import Foundation

/// Pure subtitle state model — UI- and service-agnostic so it can be unit-tested in
/// isolation and driven by any audio/STT source (microphone, broadcast, cloud).
///
/// The app layer observes updates through `onUpdate` (or wraps this in an
/// `ObservableObject` for SwiftUI).
public final class LiveSubtitleModel {
    /// Current original-language text (partial or final).
    public private(set) var originalText: String = ""

    /// Current translated text (partial or final).
    public private(set) var translatedText: String = ""

    /// Whether the current segment is finalized.
    public private(set) var isFinal: Bool = true

    /// Whether the pipeline is currently listening.
    public private(set) var isListening: Bool = false

    /// Completed final segments (transcript history).
    public private(set) var history: [SubtitleSegment] = []

    /// Maximum number of history entries kept in memory.
    public var maxHistoryCount: Int = 200

    /// Invoked on every state change.
    public var onUpdate: ((LiveSubtitleModel) -> Void)?

    public init() {}

    /// Begin a listening session.
    public func start() {
        guard !isListening else { return }
        isListening = true
        notify()
    }

    /// End the listening session and finalize any in-flight segment.
    public func stop() {
        guard isListening else { return }
        isListening = false
        isFinal = true
        notify()
    }

    /// Clear the current segment and history.
    public func clear() {
        originalText = ""
        translatedText = ""
        isFinal = true
        history.removeAll()
        notify()
    }

    /// Apply a new segment from the pipeline.
    public func update(segment: SubtitleSegment) {
        originalText = segment.original
        translatedText = segment.translated
        isFinal = segment.isFinal

        if segment.isFinal {
            history.append(segment)
            if history.count > maxHistoryCount {
                history.removeFirst(history.count - maxHistoryCount)
            }
        }
        notify()
    }

    /// Convenience: apply a plain text result with an empty translation.
    public func update(original: String, isFinal: Bool, source: String = "local") {
        update(segment: SubtitleSegment(original: original, isFinal: isFinal, source: source))
    }

    private func notify() {
        onUpdate?(self)
    }
}
