import Foundation
import LiveTranslateCore
import ReplayKit
import SwiftUI
import UIKit

/// Bridges the ReplayKit broadcast flow to the subtitle UI.
///
/// The Broadcast Upload Extension runs in its own process, streams the device's
/// audio to LTS, and appends received segments to the App Group container
/// (JSONL). This monitor tails that file (woken by a Darwin notification) and
/// forwards segments to the shared `LiveSubtitleModel`, which drives the
/// in-app overlay and the PiP window.
@MainActor
final class BroadcastMonitor: ObservableObject {
    @Published private(set) var isBroadcasting = false
    @Published private(set) var lastError: String?

    let pip = PipSubtitleController()

    private let model: LiveSubtitleModel
    private var observerToken: UnsafeMutableRawPointer?
    private var pollTask: Task<Void, Never>?
    private var lastDiag: String?
    /// Byte offset of the last consumed relay line (append-only log).
    private var relayOffset = 0
    private var lastEmptyLogTime = Date.distantPast

    init(model: LiveSubtitleModel) {
        self.model = model
        observe()
    }

    deinit {
        if let token = observerToken {
            CFNotificationCenterRemoveObserver(
                CFNotificationCenterGetDarwinNotifyCenter(),
                token,
                nil,
                nil
            )
        }
    }

    // MARK: - Observation

    private func observe() {
        // Darwin notifications cross the process boundary (extension → app).
        // The C callback receives the opaque observer pointer we registered, so
        // it can recover this instance without any globals.
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        let callback: CFNotificationCallback = { _, observer, name, _, _ in
            guard let name, let observer else { return }
            let monitor = Unmanaged<BroadcastMonitor>
                .fromOpaque(observer)
                .takeUnretainedValue()
            let raw = name.rawValue as String
            Task { @MainActor in
                monitor.handleDarwin(raw)
            }
        }
        // The token is unretained: BroadcastMonitor is owned by the app's
        // SubtitleViewModel for the whole app lifetime, so the observer is never
        // dangling. Kept to remove it cleanly in deinit.
        let token = Unmanaged.passUnretained(self).toOpaque()
        observerToken = token
        for name in [
            SegmentRelay.didAppendNotification,
            SegmentRelay.broadcastStartedNotification,
            SegmentRelay.broadcastFinishedNotification,
        ] {
            CFNotificationCenterAddObserver(
                center,
                token,
                callback,
                name as CFString,
                nil,
                .deliverImmediately
            )
        }
    }

    private func handleDarwin(_ name: String) {
        switch name {
        case SegmentRelay.didAppendNotification:
            drainRelay()
        case SegmentRelay.broadcastStartedNotification:
            DebugLog.shared.log("yayın başladı — LTS bağlantısı bekleniyor")
            isBroadcasting = true
            model.start()
            pip.start()
            relayOffset = 0
            startPolling()
        case SegmentRelay.broadcastFinishedNotification:
            stopBroadcast()
        default:
            break
        }
    }

    // MARK: - Relay draining

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 250_000_000) // 4 Hz
                await self?.drainRelay()
                // Surface the extension's live diagnostics (written to the App
                // Group by the debug build) while broadcasting.
                let diag = SharedLTSConfig.debugLine
                if !diag.isEmpty, diag != self?.lastDiag {
                    self?.lastDiag = diag
                    DebugLog.shared.log("[ext] \(diag)")
                }
            }
        }
    }

    private func drainRelay() {
        let (segments, newOffset) = SegmentRelay.readNew(from: relayOffset)
        relayOffset = newOffset
        if segments.isEmpty {
            // Rate-limit: 4 Hz of identical lines drown the diagnostics buffer.
            let now = Date()
            guard now.timeIntervalSince(lastEmptyLogTime) > 2.0 else { return }
            lastEmptyLogTime = now
            DebugLog.shared.log("yayın köprüsü: segment yok (henüz altyazı yok)")
            return
        }
        for segment in segments {
            DebugLog.shared.log("yayın segmenti: '\(segment.original)' (final=\(segment.isFinal))")
            model.update(segment: segment.subtitleSegment)
            pip.update(text: segment.translated.isEmpty ? segment.original : segment.translated)
        }
    }

    func stopBroadcast() {
        pollTask?.cancel()
        pollTask = nil
        isBroadcasting = false
        model.stop()
        pip.stop()
        // Surface the extension's failure reason (server offline, missing
        // config, quota) so the user understands why nothing arrived.
        if let error = SharedLTSConfig.lastError {
            lastError = error
        }
        SharedLTSConfig.lastError = nil
        // The file is cleared by the extension on the next start; drain the
        // last segments first, then reset the transcript for the next session.
        model.clear()
    }
}

/// The system broadcast picker (the only supported trigger on iOS 18+).
/// Pre-selects our extension so the user just taps "Start Broadcast".
struct BroadcastPickerView: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 64, height: 64))
        picker.preferredExtension = SharedLTSConfig.broadcastBundleID
        picker.showsMicrophoneButton = true
        return picker
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}
