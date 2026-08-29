import Foundation

/// LTS (Live Translation Server) configuration shared between the main app and
/// the ReplayKit broadcast extension through an App Group container.
///
/// The extension reads these values to open its own WebSocket connection to the
/// LTS server, so it keeps working even when the main app is suspended.
public enum SharedLTSConfig {
    public static let appGroupID = "group.com.stealth.subtitle.translator"
    public static let broadcastBundleID = "com.stealth.subtitle.translator.ios.broadcast"

    // UserDefaults keys
    static let keyServerURL = "lts.serverURL"
    static let keyAPIKey = "lts.apiKey"
    static let keySourceLang = "lts.sourceLang"
    static let keyTargetLang = "lts.targetLang"
    static let keyBroadcastStatus = "lts.broadcastStatus" // "idle" | "broadcasting"
    static let keyLastError = "lts.lastError"

    public static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    // MARK: - Accessors

    public static var serverURL: String {
        get { defaults?.string(forKey: keyServerURL) ?? "" }
        set { defaults?.set(newValue, forKey: keyServerURL) }
    }

    public static var apiKey: String {
        get { defaults?.string(forKey: keyAPIKey) ?? "" }
        set { defaults?.set(newValue, forKey: keyAPIKey) }
    }

    public static var sourceLang: String {
        get { defaults?.string(forKey: keySourceLang) ?? "auto" }
        set { defaults?.set(newValue, forKey: keySourceLang) }
    }

    public static var targetLang: String {
        get { defaults?.string(forKey: keyTargetLang) ?? "tr" }
        set { defaults?.set(newValue, forKey: keyTargetLang) }
    }

    public static var isBroadcasting: Bool {
        get { defaults?.string(forKey: keyBroadcastStatus) == "broadcasting" }
        set { defaults?.set(newValue ? "broadcasting" : "idle", forKey: keyBroadcastStatus) }
    }

    /// Last broadcast error (written by the extension before it fails, read by
    /// the main app when the broadcast stops).
    public static var lastError: String? {
        get { defaults?.string(forKey: keyLastError) }
        set { defaults?.set(newValue, forKey: keyLastError) }
    }

    /// True when a server URL has been configured (the LTS client can connect).
    public static var isConfigured: Bool {
        !serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
