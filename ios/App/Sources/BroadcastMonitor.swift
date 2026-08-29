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
    private var observer: NSObjectProtocol?
    private var pollTask: Task<Void, Never>?

    init(model: LiveSubtitleModel) {
        self.model = model
        observe()
    }

    deinit {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
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
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(
            center,
            observer,
            callback,
            SegmentRelay.didAppendNotification as CFString,
            nil,
            .deliverImmediately
        )
        CFNotificationCenterAddObserver(
            center,
            observer,
            callback,
            SegmentRelay.broadcastStartedNotification as CFString,
            nil,
            .deliverImmediately
        )
        CFNotificationCenterAddObserver(
            center,
            observer,
            callback,
            SegmentRelay.broadcastFinishedNotification as CFString,
            nil,
            .deliverImmediately
        )
    }

    private func handleDarwin(_ name: String) {
        switch name {
        case SegmentRelay.didAppendNotification:
            drainRelay()
        case SegmentRelay.broadcastStartedNotification:
            isBroadcasting = true
            model.start()
            pip.start()
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
            }
        }
    }

    private func drainRelay() {
        let segments = SegmentRelay.readAll()
        for segment in segments {
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
