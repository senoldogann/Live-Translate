import Foundation
import LiveTranslateCore
import ReplayKit

/// ReplayKit Broadcast Upload Extension.
///
/// Captures the device's system audio (`.audioApp` — YouTube, video calls, any
/// app) and streams it straight to the LTS server over its own WebSocket
/// connection, so subtitles keep flowing even while the main app is suspended.
/// Segments received from LTS are appended to the App Group container (JSONL)
/// and the main app is woken via a Darwin notification.
///
/// Memory discipline matters: the extension runs in a separate process with a
/// hard 50 MB cap (jetsam kills it otherwise). We never touch video frames and
/// convert audio in small buffers with `autoreleasepool`.
final class SampleHandler: RPBroadcastSampleHandler {
    private let client = LTSClient()
    private let converter = BroadcastAudioConverter()
    private var isConnected = false

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        // Defer everything to this callback — the user may cancel the system
        // picker's countdown before the broadcast actually starts.
        guard SharedLTSConfig.isConfigured else {
            fail("LTS sunucu adresi ayarlanmamış. Uygulamada Ayarlar → Bulut bölümünden sunucu adresini girin.")
            return
        }

        converter.reset()
        client.onSegment = { [weak self] segment in
            // Relay to the main app through the App Group container.
            SegmentRelay.append(RelaySegment(segment: segment))
        }
        client.onStateChange = { state in
            DebugLog.shared.log("yayın LTS durumu: \(state)")
        }
        client.onError = { [weak self] message in
            self?.fail("LTS bağlantı hatası: \(message)")
        }

        client.connect(
            serverURL: SharedLTSConfig.serverURL,
            apiKey: SharedLTSConfig.apiKey,
            sourceLang: SharedLTSConfig.sourceLang,
            targetLang: SharedLTSConfig.targetLang,
            source: "broadcast"
        )
        isConnected = true
        SharedLTSConfig.isBroadcasting = true
        SegmentRelay.postBroadcastStarted()
        SegmentRelay.clear()
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        // Only forward system/app audio (not the mic — the user picks which
        // audio source via the system picker's mic toggle).
        guard sampleBufferType == .audioApp, isConnected else { return }
        autoreleasepool {
            if let pcm = converter.convert(sampleBuffer) {
                client.sendPCMBytes(pcm)
            }
        }
    }

    override func broadcastPaused() {
        client.disconnect()
    }

    override func broadcastResumed() {
        client.connect(
            serverURL: SharedLTSConfig.serverURL,
            apiKey: SharedLTSConfig.apiKey,
            sourceLang: SharedLTSConfig.sourceLang,
            targetLang: SharedLTSConfig.targetLang,
            source: "broadcast"
        )
        isConnected = true
    }

    override func broadcastFinished() {
        client.disconnect()
        isConnected = false
        SharedLTSConfig.isBroadcasting = false
        SegmentRelay.postBroadcastFinished()
    }

    /// Writes the error to the App Group (read by the main app) and terminates
    /// the broadcast so the user sees the reason in-app.
    private func fail(_ message: String) {
        SharedLTSConfig.lastError = message
        SegmentRelay.postBroadcastFinished()
        finishBroadcastWithError(NSError(
            domain: "BroadcastExtension",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]
        ))
    }
}
