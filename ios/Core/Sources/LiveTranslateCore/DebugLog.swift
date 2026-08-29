import Foundation

/// Small thread-safe ring-buffer log for on-device diagnostics.
///
/// The subtitle pipeline writes milestones (VAD decisions, whisper passes,
/// language drops, phase changes) so that a "listening but no subtitles"
/// report can be traced to the exact failing link. Kept in Core so both the
/// app and (if ever needed) the extension can use it, and unit-testable.
public final class DebugLog {
    public struct Entry: Equatable, Sendable {
        public let timestamp: Date
        public let message: String

        public init(timestamp: Date = Date(), message: String) {
            self.timestamp = timestamp
            self.message = message
        }
    }

    /// Maximum number of entries kept in memory.
    public var capacity: Int = 300

    private var storage: [Entry] = []
    private let lock = NSLock()

    public static let shared = DebugLog()

    public init() {}

    public func log(_ message: String) {
        lock.lock()
        defer { lock.unlock() }
        storage.append(Entry(message: message))
        if storage.count > capacity {
            storage.removeFirst(storage.count - capacity)
        }
    }

    /// Snapshot of all entries (oldest first).
    public var entries: [Entry] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    public func clear() {
        lock.lock()
        defer { lock.unlock() }
        storage.removeAll()
    }

    /// Renders the log as a shareable plain-text transcript.
    public func renderedText() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return entries.map { "[\(formatter.string(from: $0.timestamp))] \($0.message)" }
            .joined(separator: "\n")
    }
}
