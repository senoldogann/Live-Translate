import XCTest
@testable import LiveTranslateCore

final class SegmentRelayTests: XCTestCase {
    func testParseRoundTrip() {
        let segments = [
            RelaySegment(original: "Merhaba", translated: "Hello", isFinal: false, confidence: 0.9, language: "tr"),
            RelaySegment(original: "Nasılsın?", translated: "How are you?", isFinal: true, confidence: 0.95, language: "tr"),
        ]
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        var data = Data()
        for segment in segments {
            data.append((try! encoder.encode(segment)))
            data.append(Data("\n".utf8))
        }
        let parsed = SegmentRelay.parse(data)
        XCTAssertEqual(parsed, segments)
    }

    func testParseIgnoresMalformedLines() {
        let data = Data("""
        {"original":"ok","translated":"","isFinal":true,"confidence":0,"language":"","source":"broadcast","ts":1.0}
        not-json
        {"original":"broken
        """.utf8)
        let parsed = SegmentRelay.parse(data)
        XCTAssertEqual(parsed.count, 1)
        XCTAssertEqual(parsed[0].original, "ok")
        XCTAssertEqual(parsed[0].isFinal, true)
        XCTAssertEqual(parsed[0].source, "broadcast")
    }

    func testParseEmpty() {
        XCTAssertTrue(SegmentRelay.parse(Data()).isEmpty)
        XCTAssertTrue(SegmentRelay.parse(Data("".utf8)).isEmpty)
    }

    func testRelaySegmentFromSubtitleSegment() {
        let subtitle = SubtitleSegment(original: "Test", translated: "Deneme", isFinal: true, confidence: 0.8, source: "local")
        let relay = RelaySegment(segment: subtitle)
        XCTAssertEqual(relay.original, "Test")
        XCTAssertEqual(relay.translated, "Deneme")
        XCTAssertEqual(relay.isFinal, true)
        XCTAssertEqual(relay.source, "broadcast")

        let back = relay.subtitleSegment
        XCTAssertEqual(back.original, "Test")
        XCTAssertEqual(back.translated, "Deneme")
        XCTAssertEqual(back.isFinal, true)
        XCTAssertEqual(back.source, "broadcast")
    }

    func testFileURLUsesAppGroup() {
        // The relay must live in the shared container, not the app sandbox.
        XCTAssertEqual(SegmentRelay.fileName, "lts_segments.jsonl")
        XCTAssertEqual(SegmentRelay.didAppendNotification, "com.stealth.lts.segments.didAppend")
    }
}
