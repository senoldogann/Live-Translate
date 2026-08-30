import Foundation

/// A segment payload persisted by the broadcast extension and read by the main
/// app through the App Group container. Kept as its own Codable type (rather
/// than reusing `SubtitleSegment`) so the on-disk format stays stable and the
/// broadcast flag is always attached.
public struct RelaySegment: Codable, Equatable, Sendable {
    public let original: String
    public let translated: String
    public let isFinal: Bool
    public let confidence: Double
    public let language: String
    public let source: String
    public let ts: TimeInterval

    public init(
        original: String,
        translated: String,
        isFinal: Bool,
        confidence: Double = 0,
        language: String = "",
        source: String = "broadcast",
        ts: TimeInterval = Date().timeIntervalSince1970
    ) {
        self.original = original
        self.translated = translated
        self.isFinal = isFinal
        self.confidence = confidence
        self.language = language
        self.source = source
        self.ts = ts
    }

    public init(segment: SubtitleSegment) {
        self.init(
            original: segment.original,
            translated: segment.translated,
            isFinal: segment.isFinal,
            confidence: segment.confidence,
            source: "broadcast",
            ts: segment.timestamp
        )
    }

    public var subtitleSegment: SubtitleSegment {
        SubtitleSegment(
            original: original,
            translated: translated,
            timestamp: ts,
            isFinal: isFinal,
            confidence: confidence,
            source: source
        )
    }
}

/// JSONL (one JSON object per line) relay between the ReplayKit broadcast
/// extension and the main app, stored in the shared App Group container.
///
/// The extension appends segments it receives from the LTS server; the main app
/// tails the file and forwards the segments to the subtitle model + PiP window.
/// A Darwin notification wakes the app immediately when a new line lands.
public enum SegmentRelay {
    public static let fileName = "lts_segments.jsonl"

    /// Darwin notification posted by the extension after appending a segment
    /// (and once when the broadcast starts/stops).
    public static let didAppendNotification = "com.stealth.lts.segments.didAppend"
    public static let broadcastStartedNotification = "com.stealth.lts.broadcast.started"
    public static let broadcastFinishedNotification = "com.stealth.lts.broadcast.finished"

    public static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedLTSConfig.appGroupID)
    }

    public static var fileURL: URL? {
        containerURL?.appendingPathComponent(fileName)
    }

    /// Appends one segment (JSON line). Returns false when the App Group
    /// container is unavailable (entitlement missing / simulator without group).
    @discardableResult
    public static func append(_ segment: RelaySegment) -> Bool {
        guard let url = fileURL else { return false }
        guard let encoder = try? JSONEncoder().encode(segment) else { return false }

        do {
            if !FileManager.default.fileExists(atPath: url.path) {
                FileManager.default.createFile(atPath: url.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: encoder)
            try handle.write(contentsOf: Data("\n".utf8))
            postAppendNotification()
            return true
        } catch {
            return false
        }
    }

    /// Reads all segments currently in the file (oldest first).
    public static func readAll() -> [RelaySegment] {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return [] }
        return parse(data)
    }

    /// Reads only the segments appended after `offset` (append-only log
    /// semantics) and returns the new byte offset to continue from.
    ///
    /// The offset advances only past **complete** lines: a line the extension is
    /// still writing is left pending and picked up on the next read instead of
    /// being half-parsed and lost. Without this, the main app re-read the whole
    /// file on every poll, re-applying every final segment — duplicating the
    /// transcript history and spamming the diagnostics log.
    public static func readNew(from offset: Int) -> (segments: [RelaySegment], newOffset: Int) {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else {
            return ([], offset)
        }
        return readNew(from: offset, data: data)
    }

    /// Data-injected variant so the append-only consumption rules are
    /// unit-testable without touching the App Group container.
    static func readNew(from offset: Int, data: Data) -> (segments: [RelaySegment], newOffset: Int) {
        let start = min(max(offset, 0), data.count)
        guard start < data.count else { return ([], data.count) }

        let newData = data.subdata(in: start..<data.count)
        // Consume up to the last "\n" so a trailing partial line stays pending.
        var consumed = 0
        if let newline = newData.lastIndex(of: 0x0A) {
            consumed = newline + 1
        }
        let complete = newData.prefix(consumed)
        return (parse(Data(complete)), start + consumed)
    }

    /// Removes the segment file (used when the broadcast ends).
    public static func clear() {
        guard let url = fileURL else { return }
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: - Parsing

    static func parse(_ data: Data) -> [RelaySegment] {
        guard let text = String(data: data, encoding: .utf8) else { return [] }
        let decoder = JSONDecoder()
        return text
            .split(separator: "\n", omittingEmptySubsequences: true)
            .compactMap { line in
                guard let lineData = String(line).data(using: .utf8) else { return nil }
                return try? decoder.decode(RelaySegment.self, from: lineData)
            }
    }

    // MARK: - Darwin notifications

    public static func postAppendNotification() {
        postDarwin(didAppendNotification)
    }

    public static func postBroadcastStarted() {
        postDarwin(broadcastStartedNotification)
    }

    public static func postBroadcastFinished() {
        postDarwin(broadcastFinishedNotification)
    }

    public static func postDarwin(_ name: String) {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name as CFString),
            nil,
            nil,
            true
        )
    }
}
