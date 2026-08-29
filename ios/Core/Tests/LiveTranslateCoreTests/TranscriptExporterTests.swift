import XCTest
@testable import LiveTranslateCore

final class TranscriptExporterTests: XCTestCase {
    // Fixed timestamps for deterministic output: 1:00:00, 1:00:02.5, 1:00:05.
    private let t1: TimeInterval = 3600
    private let t2: TimeInterval = 3602.5
    private let t3: TimeInterval = 3605

    private func segments() -> [SubtitleSegment] {
        [
            SubtitleSegment(original: "Merhaba dünya.", translated: "Hello world.", timestamp: t1, isFinal: true),
            SubtitleSegment(original: "Nasılsın?", translated: "How are you?", timestamp: t2, isFinal: true),
            SubtitleSegment(original: "İyiyim.", translated: "I'm fine.", timestamp: t3, isFinal: true),
        ]
    }

    // MARK: - Timestamps

    func testTimeStringWithoutMilliseconds() {
        XCTAssertEqual(TranscriptExporter.timeString(3600, withMilliseconds: false), "01:00:00")
        XCTAssertEqual(TranscriptExporter.timeString(3661.5, withMilliseconds: false), "01:01:01")
        XCTAssertEqual(TranscriptExporter.timeString(-5, withMilliseconds: false), "00:00:00")
    }

    func testTimeStringWithMilliseconds() {
        XCTAssertEqual(TranscriptExporter.timeString(3602.5, withMilliseconds: true), "01:00:02,500")
        XCTAssertEqual(TranscriptExporter.timeString(1.001, withMilliseconds: true), "00:00:01,001")
    }

    // MARK: - TXT

    func testPlainTextUsesTranslationWhenPresent() {
        let text = TranscriptExporter.plainText(segments())
        XCTAssertTrue(text.contains("01:00:00  Hello world."))
        XCTAssertTrue(text.contains("01:00:02  How are you?"))
        XCTAssertTrue(text.contains("01:00:05  I'm fine."))
        // Original language not shown when a translation exists.
        XCTAssertFalse(text.contains("Merhaba dünya."))
    }

    func testPlainTextFallsBackToOriginal() {
        let s = [SubtitleSegment(original: "Sadece orijinal", translated: "", timestamp: 10, isFinal: true)]
        XCTAssertEqual(TranscriptExporter.plainText(s), "00:00:10  Sadece orijinal")
    }

    func testPlainTextEmpty() {
        XCTAssertEqual(TranscriptExporter.plainText([]), "")
    }

    // MARK: - SRT

    func testSRTBlockStructure() {
        let srt = TranscriptExporter.srt(segments())
        let lines = srt.split(separator: "\n", omittingEmptySubsequences: false)

        // Block 1.
        XCTAssertEqual(lines[0], "1")
        XCTAssertEqual(lines[1], "01:00:00,000 --> 01:00:02,500")
        XCTAssertEqual(lines[2], "Hello world.")
        // Blank line separates blocks.
        XCTAssertEqual(lines[3], "")
        // Block 2.
        XCTAssertEqual(lines[4], "2")
        XCTAssertEqual(lines[5], "01:00:02,500 --> 01:00:05,000")
        XCTAssertEqual(lines[6], "How are you?")
    }

    func testSRTLastBlockUsesDefaultDuration() {
        let srt = TranscriptExporter.srt(segments())
        let lines = srt.split(separator: "\n", omittingEmptySubsequences: false)
        // Block 3 starts at 3605 and lasts defaultLastBlockDuration.
        XCTAssertEqual(lines[8], "3")
        XCTAssertEqual(lines[9], "01:00:05,000 --> 01:00:08,000")
    }

    func testSRTZeroDurationClamped() {
        let s = [
            SubtitleSegment(original: "A", timestamp: 100, isFinal: true),
            SubtitleSegment(original: "B", timestamp: 100, isFinal: true), // same ts
        ]
        let srt = TranscriptExporter.srt(s)
        let lines = srt.split(separator: "\n", omittingEmptySubsequences: false)
        // First block: next block has the same start, so the end is clamped
        // to start + 0.1 rather than a zero/negative duration.
        XCTAssertEqual(lines[1], "00:01:40,000 --> 00:01:40,100")
    }

    func testSRTEmpty() {
        XCTAssertEqual(TranscriptExporter.srt([]), "")
    }
}
