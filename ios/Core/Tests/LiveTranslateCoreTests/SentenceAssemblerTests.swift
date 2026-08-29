import XCTest
@testable import LiveTranslateCore

final class SentenceAssemblerTests: XCTestCase {

    // MARK: - Punctuation

    func testEndsWithSentencePunctuation() {
        for punct in [".", "!", "?", "…"] {
            XCTAssertTrue(SentenceAssembler.endsWithSentencePunctuation("Hello\(punct)"), "expected final for \(punct)")
        }
    }

    func testRejectsNonFinalPunctuation() {
        XCTAssertFalse(SentenceAssembler.endsWithSentencePunctuation("Hello"))
        XCTAssertFalse(SentenceAssembler.endsWithSentencePunctuation("Hello,"))
        XCTAssertFalse(SentenceAssembler.endsWithSentencePunctuation("Hello:"))
        XCTAssertFalse(SentenceAssembler.endsWithSentencePunctuation(""))
    }

    // MARK: - Plain final sentence

    func testFinalSentencePassesThrough() {
        let assembler = SentenceAssembler()
        let result = assembler.process(text: "Merhaba dünya.", isFinal: true, isTimeoutCut: false)
        XCTAssertEqual(result, "Merhaba dünya.")
        XCTAssertTrue(assembler.lastContext.isEmpty == false)
        XCTAssertEqual(assembler.lastContext, "Merhaba dünya.")
        XCTAssertEqual(assembler.lastPartialText, "")
    }

    func testEmptyTextReturnsNil() {
        let assembler = SentenceAssembler()
        XCTAssertNil(assembler.process(text: "   ", isFinal: true, isTimeoutCut: false))
        XCTAssertNil(assembler.process(text: "", isFinal: false, isTimeoutCut: false))
    }

    // MARK: - Timeout cut fragment buffering

    func testTimeoutCutWithoutPunctuationIsBuffered() {
        let assembler = SentenceAssembler()
        let result = assembler.process(text: "Merhaba dünya", isFinal: true, isTimeoutCut: true)
        XCTAssertNil(result, "mid-sentence timeout cut must be buffered, not published")
        XCTAssertEqual(assembler.fragmentBuffer, ["Merhaba dünya"])
        XCTAssertEqual(assembler.lastPartialText, "Merhaba dünya")
    }

    func testTimeoutCutWithPunctuationIsPublished() {
        let assembler = SentenceAssembler()
        let result = assembler.process(text: "Merhaba dünya.", isFinal: true, isTimeoutCut: true)
        XCTAssertEqual(result, "Merhaba dünya.")
        XCTAssertTrue(assembler.fragmentBuffer.isEmpty)
    }

    func testBufferedFragmentMergesWithNextFinal() {
        let assembler = SentenceAssembler()
        XCTAssertNil(assembler.process(text: "Merhaba dünya", isFinal: true, isTimeoutCut: true))
        let merged = assembler.process(text: "nasılsın?", isFinal: true, isTimeoutCut: false)
        XCTAssertEqual(merged, "Merhaba dünya nasılsın?")
        XCTAssertTrue(assembler.fragmentBuffer.isEmpty)
    }

    func testMultipleFragmentsMergeInOrder() {
        let assembler = SentenceAssembler()
        _ = assembler.process(text: "Birinci", isFinal: true, isTimeoutCut: true)
        _ = assembler.process(text: "ikinci", isFinal: true, isTimeoutCut: true)
        let merged = assembler.process(text: "üçüncü.", isFinal: true, isTimeoutCut: false)
        XCTAssertEqual(merged, "Birinci ikinci üçüncü.")
    }

    func testFragmentBufferCapsAtMaxCount() {
        let assembler = SentenceAssembler()
        assembler.maxFragmentCount = 3
        _ = assembler.process(text: "1", isFinal: true, isTimeoutCut: true)
        _ = assembler.process(text: "2", isFinal: true, isTimeoutCut: true)
        _ = assembler.process(text: "3", isFinal: true, isTimeoutCut: true)
        // 4th fragment exceeds the cap → buffer is force-flushed, only the new one is kept.
        _ = assembler.process(text: "4", isFinal: true, isTimeoutCut: true)
        XCTAssertEqual(assembler.fragmentBuffer, ["4"])
    }

    // MARK: - Streaming partial dedup

    func testDuplicatePartialIsSkipped() {
        let assembler = SentenceAssembler()
        assembler.isStreaming = true
        XCTAssertEqual(assembler.process(text: "Merhaba", isFinal: false, isTimeoutCut: false), "Merhaba")
        XCTAssertNil(assembler.process(text: "Merhaba", isFinal: false, isTimeoutCut: false), "duplicate partial must be skipped")
    }

    func testUpdatedPartialIsPublished() {
        let assembler = SentenceAssembler()
        XCTAssertEqual(assembler.process(text: "Merhaba", isFinal: false, isTimeoutCut: false), "Merhaba")
        XCTAssertEqual(assembler.process(text: "Merhaba dünya", isFinal: false, isTimeoutCut: false), "Merhaba dünya")
        XCTAssertEqual(assembler.lastPartialText, "Merhaba dünya")
    }

    func testFinalAfterPartialResetsPartialState() {
        let assembler = SentenceAssembler()
        _ = assembler.process(text: "Merhaba dünya", isFinal: false, isTimeoutCut: false)
        let result = assembler.process(text: "Merhaba dünya.", isFinal: true, isTimeoutCut: false)
        XCTAssertEqual(result, "Merhaba dünya.")
        XCTAssertEqual(assembler.lastPartialText, "")
        XCTAssertEqual(assembler.lastContext, "Merhaba dünya.")
    }

    // MARK: - Stable mode

    func testStableModeSuppressesPartials() {
        let assembler = SentenceAssembler()
        assembler.isStreaming = false
        XCTAssertNil(assembler.process(text: "Merhaba", isFinal: false, isTimeoutCut: false))
        XCTAssertEqual(assembler.process(text: "Merhaba dünya.", isFinal: true, isTimeoutCut: false), "Merhaba dünya.")
    }

    // MARK: - Reset

    func testResetClearsState() {
        let assembler = SentenceAssembler()
        _ = assembler.process(text: "Merhaba", isFinal: true, isTimeoutCut: true)
        _ = assembler.process(text: "Nasılsın", isFinal: false, isTimeoutCut: false)
        assembler.reset()
        XCTAssertTrue(assembler.fragmentBuffer.isEmpty)
        XCTAssertEqual(assembler.lastPartialText, "")
        XCTAssertEqual(assembler.lastContext, "")
    }
}
