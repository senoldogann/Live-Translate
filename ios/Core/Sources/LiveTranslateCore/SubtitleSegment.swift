import Foundation

/// A single transcription/translation result flowing through the pipeline.
///
/// Mirrors `TranscriptResult` in the macOS `python/engine.py` core.
public struct SubtitleSegment: Equatable, Hashable, Sendable {
    public let original: String
    public let translated: String
    public let timestamp: TimeInterval
    public let isFinal: Bool
    public let confidence: Double
    public let source: String

    public init(
        original: String,
        translated: String = "",
        timestamp: TimeInterval = Date().timeIntervalSince1970,
        isFinal: Bool,
        confidence: Double = 0.0,
        source: String = "local"
    ) {
        self.original = original
        self.translated = translated
        self.timestamp = timestamp
        self.isFinal = isFinal
        self.confidence = confidence
        self.source = source
    }
}
