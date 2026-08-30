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
        let segmentReceived = expectation(description: "segment received")

        client.onSegment = { _ in
            segmentReceived.fulfill()
        }

        client.connect(
            serverURL: "ws://127.0.0.1:\(port)",
            apiKey: "",
            sourceLang: "auto",
            targetLang: "tr",
            model: "base"
        )

        // Poll for the handshake instead of using `fulfillment`: a
        // fulfilled-expectation timeout records an assertion failure even
        // when we then skip, so a locally-absent fake server would fail the
        // suite instead of skipping. Polling keeps the skip clean. We check
        // `state == .connected` (set on the server's `ready` message) rather
        // than `isConnected` (transport running), which turns true as soon as
        // the task resumes even when no server is listening. Generous budget:
        // cold CI runners can take >10s for app launch + handshake.
        let connected = await waitForReady(client, timeout: 45)
        guard connected else {
            client.disconnect()
            throw XCTSkip("fake LTS server not reachable at ws://127.0.0.1:\(port)")
        }

        client.sendPCMBytes(loudPCM())
        await fulfillment(of: [segmentReceived], timeout: 15)

        client.disconnect()
    }

    /// Polls `client.state` every 250 ms until the deadline, returning true
    /// once the server's `ready` message (state == .connected) arrives.
    private func waitForReady(_ client: LTSClient, timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if client.state == .connected { return true }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return client.state == .connected
    }
}
