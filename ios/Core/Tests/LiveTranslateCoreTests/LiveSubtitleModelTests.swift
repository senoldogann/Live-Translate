import XCTest
@testable import LiveTranslateCore

final class LiveSubtitleModelTests: XCTestCase {

    func testInitialState() {
        let model = LiveSubtitleModel()
        XCTAssertEqual(model.originalText, "")
        XCTAssertEqual(model.translatedText, "")
        XCTAssertTrue(model.isFinal)
        XCTAssertFalse(model.isListening)
        XCTAssertTrue(model.history.isEmpty)
    }

    func testPartialUpdateSetsCurrentText() {
        let model = LiveSubtitleModel()
        model.update(segment: SubtitleSegment(original: "Merhaba", isFinal: false))
        XCTAssertEqual(model.originalText, "Merhaba")
        XCTAssertFalse(model.isFinal)
        XCTAssertTrue(model.history.isEmpty, "partial segments must not enter history")
    }

    func testFinalUpdateAppendsHistory() {
        let model = LiveSubtitleModel()
        model.update(segment: SubtitleSegment(original: "Merhaba dünya.", translated: "Hello world.", isFinal: true))
        XCTAssertEqual(model.history.count, 1)
        XCTAssertEqual(model.history[0].original, "Merhaba dünya.")
        XCTAssertEqual(model.history[0].translated, "Hello world.")
        XCTAssertTrue(model.isFinal)
    }

    func testHistoryIsCapped() {
        let model = LiveSubtitleModel()
        model.maxHistoryCount = 3
        for i in 0..<10 {
            model.update(segment: SubtitleSegment(original: "Cümle \(i).", isFinal: true))
        }
        XCTAssertEqual(model.history.count, 3)
        XCTAssertEqual(model.history.first?.original, "Cümle 7.")
        XCTAssertEqual(model.history.last?.original, "Cümle 9.")
    }

    func testStartStopLifecycle() {
        let model = LiveSubtitleModel()
        model.start()
        XCTAssertTrue(model.isListening)
        model.start() // idempotent
        XCTAssertTrue(model.isListening)
        model.stop()
        XCTAssertFalse(model.isListening)
        XCTAssertTrue(model.isFinal)
    }

    func testClearResetsEverything() {
        let model = LiveSubtitleModel()
        model.start()
        model.update(segment: SubtitleSegment(original: "Cümle.", isFinal: true))
        model.clear()
        XCTAssertEqual(model.originalText, "")
        XCTAssertEqual(model.translatedText, "")
        XCTAssertTrue(model.isFinal)
        XCTAssertTrue(model.history.isEmpty)
        XCTAssertTrue(model.isListening, "clear must not stop the listening session")
    }

    func testOnUpdateNotified() {
        let model = LiveSubtitleModel()
        var updates = 0
        model.onUpdate = { _ in updates += 1 }
        model.start()
        model.update(segment: SubtitleSegment(original: "Selam", isFinal: false))
        model.stop()
        model.clear()
        XCTAssertEqual(updates, 4)
    }
}
