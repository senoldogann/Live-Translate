import XCTest
@testable import LiveTranslateCore

final class DebugLogTests: XCTestCase {
    func testLogAndSnapshot() {
        let log = DebugLog()
        log.log("bir")
        log.log("iki")
        let entries = log.entries
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[0].message, "bir")
        XCTAssertEqual(entries[1].message, "iki")
    }

    func testRingBufferCapacity() {
        let log = DebugLog()
        log.capacity = 5
        for i in 0..<10 {
            log.log("msg\(i)")
        }
        let entries = log.entries
        XCTAssertEqual(entries.count, 5)
        XCTAssertEqual(entries.first?.message, "msg5")
        XCTAssertEqual(entries.last?.message, "msg9")
    }

    func testClear() {
        let log = DebugLog()
        log.log("x")
        log.clear()
        XCTAssertTrue(log.entries.isEmpty)
    }

    func testRenderedText() {
        let log = DebugLog()
        log.log("VAD: speech (rms=0.123)")
        log.log("whisper: ok")
        let text = log.renderedText()
        XCTAssertTrue(text.contains("VAD: speech (rms=0.123)"))
        XCTAssertTrue(text.contains("whisper: ok"))
        // One entry per line.
        XCTAssertEqual(text.split(separator: "\n").count, 2)
    }
}
