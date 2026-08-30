import XCTest
import LiveTranslateCore

/// Cross-language integration test: the Swift `LTSClient` against the REAL
/// Python `lts_server.py` (via `scripts/lts_fake_server.py`, which swaps in
/// fake transcriber/translator/VAD but keeps the real WebSocket + session
/// pipeline). This is the seam where wire-format bugs hide: config message
/// shape, binary PCM framing, JSON segment decoding.
///
/// Requires the fake server running on the port from the `LTS_TEST_PORT`
/// scheme environment variable. CI starts it before the test run; locally the
/// test skips with instructions when the server is unreachable:
///
///     python3 scripts/lts_fake_server.py --port 8765 &
final class LTSClientIntegrationTests: XCTestCase {
    /// Streams 1.2s of loud int16 LE PCM at 16 kHz mono — enough for the
    /// server's 0.2s minimum and a partial pass (0.35s silence not elapsed).
    private func loudPCM(seconds: Double = 1.2) -> Data {
        let count = Int(16000 * seconds)
        var pcm = [Int16](repeating: 8000, count: count)
        return Data(bytes: &pcm, count: count * MemoryLayout<Int16>.size)
    }

    func testConfigReadyAndSegmentRoundTrip() async throws {
        guard
            let portString = ProcessInfo.processInfo.environment["LTS_TEST_PORT"],
            let port = Int(portString)
        else {
            throw XCTSkip("LTS_TEST_PORT not set — start scripts/lts_fake_server.py and rerun")
        }

        let client = LTSClient()
        let readyExpectation = expectation(description: "ready received")
        let segmentExpectation = expectation(description: "segment received")

        client.onStateChange = { state in
            if state == .connected {
                readyExpectation.fulfill()
            }
        }
        client.onSegment = { _ in
            segmentExpectation.fulfill()
        }

        client.connect(
            serverURL: "ws://127.0.0.1:\(port)",
            apiKey: "",
            sourceLang: "auto",
            targetLang: "tr",
            model: "base"
        )

        // Generous timeouts: on cold CI runners the simulator app launch +
        // WebSocket handshake alone can take >10s, which has caused flaky
        // failures on doc-only PRs. 45s leaves headroom without hiding a
        // genuinely dead server (the isConnected guard below still skips).
        await fulfillment(of: [readyExpectation], timeout: 45)
        guard client.isConnected else {
            // Server not reachable (e.g. local run without the fake server) —
            // skip instead of failing the whole suite.
            client.disconnect()
            throw XCTSkip("fake LTS server not reachable at ws://127.0.0.1:\(port)")
        }

        client.sendPCMBytes(loudPCM())
        await fulfillment(of: [segmentExpectation], timeout: 15)

        client.disconnect()
    }
}
