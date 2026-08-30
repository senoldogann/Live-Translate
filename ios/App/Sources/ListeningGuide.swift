import Foundation

/// Pure, testable logic for guiding the user between the app's two audio
/// flows, which is a recurring source of confusion:
///
/// - **Mic flow** (`SubtitlePipeline`): translates speech picked up by the
///   phone's microphone — i.e. someone talking next to the device.
/// - **Broadcast flow** (`SampleHandler` + LTS server): captures *system*
///   audio (YouTube, calls, any app) via ReplayKit, sends it to the LTS
///   server, and streams translated segments back.
///
/// A user who sees "Dinleniyor" while playing a video expects subtitles but
/// gets none, because the mic flow cannot hear video audio. This type
/// centralizes the copy and the conditions so the UI stays thin and the
/// guidance is unit-testable.
enum ListeningGuide {
    /// The three concrete steps required for video subtitles, shown on first
    /// launch and in Settings. Order matters: server → address → broadcast.
    static let broadcastSteps: [(title: String, detail: String)] = [
        (
            "Mac'te sunucuyu başlat",
            "cd python && .venv/bin/python lts_server.py  (telefonla aynı Wi-Fi)"
        ),
        (
            "Ayarlar'da sunucu adresini gir",
            "ws://<Mac-LAN-IP>:8765 — örn. ws://192.168.1.25:8765"
        ),
        (
            "Kontrol Merkezi'nden yayını başlat",
            "Ekran kaydına basılı tut → LiveTranslateBroadcast → başlat"
        )
    ]

    /// One-line explanation distinguishing the two flows, used in the first
    /// launch sheet.
    static let flowExplanation =
        "Mikrofon modu yanınızdaki konuşmaları çevirir. Video sesi için yayın (broadcast) akışı gerekir — cihaz sesini yakalayıp sunucuya gönderir."

    /// Status-bar hint: while the mic pipeline is running and no broadcast is
    /// active, remind the user that the mic only hears nearby speech, so a
    /// silent video is expected unless they start the broadcast flow.
    ///
    /// - Parameters:
    ///   - isListening: whether the mic pipeline is currently running.
    ///   - isBroadcasting: whether the broadcast extension is active.
    ///   - translationProvider: the selected provider id ("passthrough" or
    ///     "lts"); broadcast only applies in cloud mode.
    static func statusHint(
        isListening: Bool,
        isBroadcasting: Bool,
        translationProvider: String
    ) -> String? {
        guard isListening, !isBroadcasting, translationProvider == "lts" else { return nil }
        return "Mikrofon yanınızdaki sesi duyar. Video sesi için yayını başlat: Ayarlar → sunucu adresi → Kontrol Merkezi → ekran kaydına basılı tut."
    }

    /// Whether the first-launch guide sheet should be shown (one-shot flag).
    static func shouldShowFirstLaunchGuide(hasSeenGuide: Bool) -> Bool {
        !hasSeenGuide
    }
}
