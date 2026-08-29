import ActivityKit
import Foundation

/// Live Activity payload shared between the app target and the widget extension.
/// The type must be identical in both targets — ActivityKit uses it to render
/// the activity on the Lock Screen and in the Dynamic Island.
public struct LiveSubtitleAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Current original-language text (partial or final).
        public var originalText: String
        /// Current translated text.
        public var translatedText: String
        /// Whether the current segment is finalized.
        public var isFinal: Bool
        /// Source language code shown in the widget (e.g. "en").
        public var sourceLanguage: String
        /// Target language code shown in the widget (e.g. "tr").
        public var targetLanguage: String

        public init(
            originalText: String,
            translatedText: String,
            isFinal: Bool,
            sourceLanguage: String,
            targetLanguage: String
        ) {
            self.originalText = originalText
            self.translatedText = translatedText
            self.isFinal = isFinal
            self.sourceLanguage = sourceLanguage
            self.targetLanguage = targetLanguage
        }
    }

    /// Fixed for the lifetime of the activity.
    public var sourceLanguage: String
    public var targetLanguage: String
    public var startedAt: Date

    public init(sourceLanguage: String, targetLanguage: String, startedAt: Date = Date()) {
        self.sourceLanguage = sourceLanguage
        self.targetLanguage = targetLanguage
        self.startedAt = startedAt
    }
}
