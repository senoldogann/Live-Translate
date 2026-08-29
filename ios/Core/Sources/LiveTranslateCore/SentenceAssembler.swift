import Foundation

/// Sentence-integrity logic ported from `python/engine.py` (`_process_loop`).
///
/// Responsibilities:
/// - Detect sentence-final punctuation so mid-speech cuts are not shown as broken text.
/// - Buffer fragments from max-duration cuts and merge them with the next final sentence.
/// - Deduplicate repeated partial transcriptions in streaming mode.
/// - Keep the previous sentence as context for the next transcription pass.
///
/// The class is not thread-safe; call it from a single serial queue.
public final class SentenceAssembler {
    /// Maximum number of buffered mid-sentence fragments before force-flushing.
    public var maxFragmentCount: Int = 5

    /// When `true`, partial (streaming) results are published; otherwise only finals are.
    /// Mirrors `config.streaming_mode` in the macOS engine.
    public var isStreaming: Bool = true

    /// Fragments collected from max-duration cuts that landed mid-sentence.
    public private(set) var fragmentBuffer: [String] = []

    /// Last published partial text, used to skip duplicate partial results.
    public private(set) var lastPartialText: String = ""

    /// Last final sentence, used as transcription context (Whisper `prompt`).
    public private(set) var lastContext: String = ""

    public init() {}

    /// True when the text ends with a sentence-final punctuation mark (`.`, `!`, `?`, `…`).
    public static func endsWithSentencePunctuation(_ text: String) -> Bool {
        guard let last = text.last else { return false }
        return last == "." || last == "!" || last == "?" || last == "\u{2026}"
    }

    /// Feed one raw transcription result.
    ///
    /// - Parameters:
    ///   - text: The transcribed text (may be a partial or a final sentence).
    ///   - isFinal: Whether the transcription is a finalized segment.
    ///   - isTimeoutCut: Whether finalization was forced by a max-duration timeout rather
    ///     than silence or sentence end.
    /// - Returns: The text to publish, or `nil` when the result must be buffered or skipped.
    public func process(text: String, isFinal: Bool, isTimeoutCut: Bool) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // 1. A max-duration cut that lands mid-sentence: buffer the fragment and merge it
        //    with the next transcription instead of showing a broken half-sentence as final.
        if isFinal && isTimeoutCut && !Self.endsWithSentencePunctuation(trimmed) {
            if fragmentBuffer.count < maxFragmentCount {
                fragmentBuffer.append(trimmed)
            } else {
                // Safety cap: never hold a single unbounded fragment chain.
                fragmentBuffer.removeAll()
                fragmentBuffer.append(trimmed)
            }
            lastPartialText = trimmed
            return nil
        }

        // 2. Merge any buffered half-sentence fragments with the complete sentence.
        var result = trimmed
        if isFinal && !fragmentBuffer.isEmpty {
            result = (fragmentBuffer + [trimmed]).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            fragmentBuffer.removeAll()
        }

        // 3. Stable mode only publishes final sentences.
        if !isFinal && !isStreaming {
            return nil
        }

        // 4. Deduplicate repeated partial transcriptions.
        if isStreaming && !isFinal && result == lastPartialText {
            return nil
        }

        // 5. Track context and partial dedup state.
        if isFinal {
            lastContext = result
            lastPartialText = ""
        } else {
            lastPartialText = result
        }

        return result
    }

    /// Reset all internal state (used when stopping or switching languages).
    public func reset() {
        fragmentBuffer.removeAll()
        lastPartialText = ""
        lastContext = ""
    }
}
