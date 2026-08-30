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
    private var totalCalls = 0
    private var videoCalls = 0
    private var audioAppCalls = 0
    private var audioMicCalls = 0
    private var otherCalls = 0
    private var audioAppConnectedCalls = 0
    private var convertFailures = 0

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        // Diagnostics: prove the extension actually starts.
        writeDebug("broadcastStarted (config=\(SharedLTSConfig.isConfigured), url=\(SharedLTSConfig.serverURL))")

        // Defer everything to this callback — the user may cancel the system
        // picker's countdown before the broadcast actually starts.
        guard SharedLTSConfig.isConfigured else {
            fail("LTS sunucu adresi ayarlanmamış. Uygulamada Ayarlar → Bulut bölümünden sunucu adresini girin.")
            return
        }

        converter.reset()
        client.onSegment = { segment in
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
        // Clear any segments left over from a previous session BEFORE waking the
        // app — otherwise the app races the clear and replays stale subtitles.
        SegmentRelay.clear()
        SegmentRelay.postBroadcastStarted()
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        // TEMP DEBUG: count EVERY buffer type so we can tell whether ReplayKit
        // is delivering video, mic audio, or app audio at all.
        totalCalls += 1
        switch sampleBufferType {
        case .video: videoCalls += 1
        case .audioApp: audioAppCalls += 1
        case .audioMic: audioMicCalls += 1
        @unknown default: otherCalls += 1
        }
        if sampleBufferType == .audioApp && isConnected {
            audioAppConnectedCalls += 1
            autoreleasepool {
                if let pcm = converter.convert(sampleBuffer) {
                    client.sendPCMBytes(pcm)
                } else {
                    convertFailures += 1
                }
            }
        }
        // Rate-limited diagnostics: every 30 buffers (≈ every ~0.3-1s of
        // capture) write the counters so the app shows what is arriving.
        if totalCalls % 30 == 1 {
            writeDebug("buf total=\(totalCalls) video=\(videoCalls) app=\(audioAppCalls) mic=\(audioMicCalls) convFail=\(convertFailures) sent=\(audioAppConnectedCalls - convertFailures)")
        }
    }

    override func broadcastPaused() {
        client.disconnect()
        isConnected = false
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

    /// Writes a diagnostics line to the App Group so the main app (🩺) can show
    /// what the extension is doing. Uses the dedicated debug channel so routine
    /// counters are never surfaced as failures in the main UI.
    private func writeDebug(_ message: String) {
        DebugLog.shared.log("[ext] \(message)")
        SharedLTSConfig.debugLine = message
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
