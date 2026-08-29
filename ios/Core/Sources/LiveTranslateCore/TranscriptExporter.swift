import Foundation

/// Serializes finished transcript segments into plain-text (TXT) and
/// SubRip (SRT) formats for sharing/export.
///
/// SRT follows the standard block layout:
///
///     1
///     00:00:01,000 --> 00:00:03,500
///     Merhaba dünya.
///     Hello world.
///
/// Timestamps use HH:MM:SS,mmm with a comma before milliseconds (SRT rule).
/// Because segments carry only a start timestamp, the end time of each block
/// is derived from the next segment's start (or a fixed display duration for
/// the final block).
public enum TranscriptExporter {
    /// Minimum display duration for the last SRT block (seconds).
    public static let defaultLastBlockDuration: TimeInterval = 3.0

    /// Renders a readable transcript with one line per segment:
    /// `HH:MM:SS  original — translated`.
    public static func plainText(_ segments: [SubtitleSegment]) -> String {
        let lines = segments.map { segment -> String in
            let time = Self.timeString(segment.timestamp, withMilliseconds: false)
            let text = segment.translated.isEmpty ? segment.original : segment.translated
            return "\(time)  \(text)"
        }
        return lines.joined(separator: "\n")
    }

    /// Renders a standard SRT document. Segments must be in chronological order
    /// (they are emitted in history order by `LiveSubtitleModel`).
    public static func srt(_ segments: [SubtitleSegment]) -> String {
        var blocks: [String] = []
        for (index, segment) in segments.enumerated() {
            let start = segment.timestamp
            let end: TimeInterval
            if index + 1 < segments.count {
                end = segments[index + 1].timestamp
            } else {
                end = start + defaultLastBlockDuration
            }
            // Guard against zero/negative durations (same timestamp twice).
            let safeEnd = max(end, start + 0.1)

            let text = segment.translated.isEmpty ? segment.original : segment.translated
            let block = [
                "\(index + 1)",
                "\(Self.timeString(start, withMilliseconds: true)) --> \(Self.timeString(safeEnd, withMilliseconds: true))",
                text,
            ].joined(separator: "\n")
            blocks.append(block)
        }
        // Blank line between blocks (SRT requirement); no trailing blank line.
        return blocks.joined(separator: "\n\n")
    }

    // MARK: - Timestamps

    /// Formats a Unix timestamp as `HH:MM:SS` (or `HH:MM:SS,mmm`).
    static func timeString(_ timestamp: TimeInterval, withMilliseconds: Bool) -> String {
        let clamped = max(0, timestamp)
        // Round the fractional second to avoid float truncation (1.001 must
        // not render as 00:00:01,000).
        let totalMilliseconds = Int((clamped * 1000).rounded())
        let hours = totalMilliseconds / 3_600_000
        let minutes = (totalMilliseconds % 3_600_000) / 60_000
        let seconds = (totalMilliseconds % 60_000) / 1000
        let millis = totalMilliseconds % 1000

        if withMilliseconds {
            return String(format: "%02d:%02d:%02d,%03d", hours, minutes, seconds, millis)
        }
        return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
    }
}
