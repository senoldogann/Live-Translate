import Foundation

/// WebSocket client for the LTS (Live Translation Server).
///
/// Protocol (matches `python/lts_server.py`):
/// 1. Connect, then send a JSON config message:
///    {"type":"config","apiKey":"...","sourceLang":"auto","targetLang":"tr","model":"base"}
/// 2. Stream mono 16 kHz PCM as int16 LE binary frames.
/// 3. Receive JSON messages: {"type":"ready"...} then {"type":"segment",...}.
///
/// Used by the app's cloud STT mode and by the broadcast extension (which opens
/// its own connection so it keeps working while the app is suspended).
public final class LTSClient {
    public enum State: Equatable {
        case idle
        case connecting
        case connected
        case failed(String)
    }

    public private(set) var state: State = .idle {
        didSet { onStateChange?(state) }
    }

    public var onStateChange: ((State) -> Void)?
    public var onSegment: ((SubtitleSegment) -> Void)?
    public var onError: ((String) -> Void)?

    private var task: URLSessionWebSocketTask?
    private let queue = DispatchQueue(label: "com.stealth.lts.client", qos: .userInitiated)

    public init() {}

    public var isConnected: Bool {
        task?.state == .running
    }

    // MARK: - Lifecycle

    public func connect(
        serverURL: String,
        apiKey: String,
        sourceLang: String,
        targetLang: String,
        model: String = "base",
        source: String = "cloud"
    ) {
        guard let url = URL(string: serverURL), !state.isActive else { return }
        state = .connecting

        let request = URLRequest(url: url, timeoutInterval: 30)
        let session = URLSession(configuration: .default, delegate: nil, delegateQueue: nil)
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()

        // Config message first.
        let config: [String: String] = [
            "type": "config",
            "apiKey": apiKey,
            "sourceLang": sourceLang,
            "targetLang": targetLang,
            "model": model,
        ]
        let data = try? JSONSerialization.data(withJSONObject: config)
        if let data {
            task.send(.data(data)) { [weak self] error in
                if let error {
                    self?.fail("Config gönderilemedi: \(error.localizedDescription)")
                }
            }
        }
        receiveLoop(source: source)
    }

    /// Streams mono 16 kHz float32 samples (converted to int16 LE on the wire).
    public func sendPCM(_ samples: [Float]) {
        guard let task, task.state == .running else { return }
        var pcm = [Int16](repeating: 0, count: samples.count)
        for (i, s) in samples.enumerated() {
            let clamped = max(-1.0, min(1.0, Double(s)))
            pcm[i] = Int16(clamped * 32767.0)
        }
        let data = Data(bytes: pcm, count: pcm.count * MemoryLayout<Int16>.size)
        task.send(.data(data)) { _ in }
    }

    /// Streams already-converted int16 LE PCM bytes (used by the broadcast
    /// extension, which converts ReplayKit buffers before sending).
    public func sendPCMBytes(_ data: Data) {
        guard let task, task.state == .running else { return }
        task.send(.data(data)) { _ in }
    }

    public func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        state = .idle
    }

    // MARK: - Receive

    private func receiveLoop(source: String) {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(.data(let data)):
                self.handleMessage(data, source: source)
            case .success(.string(let string)):
                if let data = string.data(using: .utf8) {
                    self.handleMessage(data, source: source)
                }
            case .failure(let error):
                self.fail(error.localizedDescription)
                return
            }
            self.receiveLoop(source: source)
        }
    }

    private func handleMessage(_ data: Data, source: String) {
        guard
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = obj["type"] as? String
        else { return }

        switch type {
        case "ready":
            queue.async { [weak self] in self?.state = .connected }
        case "segment":
            guard
                let original = obj["original"] as? String,
                let translated = obj["translated"] as? String,
                let isFinal = obj["isFinal"] as? Bool
            else { return }
            let confidence = (obj["confidence"] as? Double) ?? 0
            let language = (obj["language"] as? String) ?? ""
            let segment = SubtitleSegment(
                original: original,
                translated: translated,
                isFinal: isFinal,
                confidence: confidence,
                source: source
            )
            onSegment?(segment)
        case "error":
            let message = (obj["message"] as? String) ?? "Bilinmeyen hata"
            onError?(message)
            queue.async { [weak self] in self?.state = .failed(message) }
        default:
            break
        }
    }

    private func fail(_ message: String) {
        queue.async { [weak self] in
            self?.state = .failed(message)
            self?.onError?(message)
        }
    }
}

private extension LTSClient.State {
    var isActive: Bool {
        switch self {
        case .idle, .failed:
            return false
        case .connecting, .connected:
            return true
        }
    }
}
