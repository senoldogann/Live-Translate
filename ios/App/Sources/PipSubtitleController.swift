import AVFoundation
import AVKit
import CoreVideo
import Foundation
import UIKit

/// Picture-in-Picture subtitle window (Path B — custom content).
///
/// Instead of pushing real video frames, we render the subtitle text into a
/// CVPixelBuffer at a low frame rate (on segment change) and enqueue it to an
/// `AVSampleBufferDisplayLayer`. The system mirrors that layer into the PiP
/// window, which keeps rendering while the app is backgrounded — exactly how
/// live-caption apps like Minispeech ship on the App Store.
///
/// Requirements (verified against Apple docs + production guides):
/// - `UIBackgroundModes: [audio]` (already in Info.plist)
/// - Active audio session with `.playback` category
/// - Strong reference to `AVPictureInPictureController` (a local var silently
///   deallocates and PiP never appears)
/// - `AVPictureInPictureSampleBufferPlaybackDelegate` implemented
/// - Back-pressure check (`isReadyForMoreMediaData`) before every enqueue
final class PipSubtitleController: NSObject, ObservableObject {
    @Published private(set) var isPipActive = false

    private var pipController: AVPictureInPictureController?
    private let displayLayer = AVSampleBufferDisplayLayer()
    private var bufferPool: CVPixelBufferPool?
    private var lastRenderText = ""
    private var displayLink: CADisplayLink?
    private var latestText = ""

    private static let width = 1280
    private static let height = 720

    // MARK: - Setup

    func configure() {
        guard pipController == nil else { return }
        guard AVPictureInPictureController.isPictureInPictureSupported() else { return }

        displayLayer.videoGravity = .resizeAspect
        displayLayer.backgroundColor = UIColor.black.cgColor

        let source = AVPictureInPictureController.ContentSource(
            sampleBufferDisplayLayer: displayLayer,
            playbackDelegate: self
        )
        let controller = AVPictureInPictureController(contentSource: source)
        controller.delegate = self
        controller.requiresLinearPlayback = true
        // Hide transport controls (fast-forward/rewind make no sense for text).
        controller.setValue(1, forKey: "controlsStyle")
        self.pipController = controller

        setupBufferPool()
    }

    private func setupBufferPool() {
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: Self.width,
            kCVPixelBufferHeightKey as String: Self.height,
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
        ]
        CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &bufferPool)
    }

    // MARK: - Control

    /// Starts the PiP window (audio session + controller). Call once the
    /// broadcast begins.
    func start() {
        configure()
        guard let pipController else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)
        pipController.startPictureInPicture()
        isPipActive = true
        render(text: latestText)
    }

    func stop() {
        pipController?.stopPictureInPicture()
        isPipActive = false
    }

    /// Updates the displayed text. Renders a fresh frame on the main thread;
    /// the display link keeps the PiP window "alive" for live content.
    func update(text: String) {
        latestText = text
        guard isPipActive else { return }
        render(text: text)
    }

    private func render(text: String) {
        guard isPipActive, text != lastRenderText else { return }
        lastRenderText = text
        guard let pixelBuffer = makePixelBuffer() else { return }
        draw(text: text, into: pixelBuffer)

        guard let formatDesc = makeFormatDescription(for: pixelBuffer) else { return }
        var timing = CMSampleTimingInfo(
            duration: .invalid,
            presentationTimeStamp: CMTime(value: 0, timescale: 600),
            decodeTimeStamp: .invalid
        )
        var sampleBuffer: CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescription: formatDesc,
            sampleTiming: &timing,
            sampleBufferOut: &sampleBuffer
        )
        guard let sampleBuffer, displayLayer.isReadyForMoreMediaData else { return }
        displayLayer.enqueue(sampleBuffer)
    }

    // MARK: - Frame rendering

    private func makePixelBuffer() -> CVPixelBuffer? {
        var pixelBuffer: CVPixelBuffer?
        guard let bufferPool else { return nil }
        CVPixelBufferPoolCreatePixelBuffer(nil, bufferPool, &pixelBuffer)
        return pixelBuffer
    }

    private func makeFormatDescription(for pixelBuffer: CVPixelBuffer) -> CMVideoFormatDescription? {
        var formatDesc: CMVideoFormatDescription?
        CMVideoFormatDescriptionCreateForImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescriptionOut: &formatDesc
        )
        return formatDesc
    }

    private func draw(text: String, into pixelBuffer: CVPixelBuffer) {
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }

        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)

        let ctx = CGContext(
            data: base,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        )
        guard let ctx else { return }

        ctx.setFillColor(UIColor.black.withAlphaComponent(0.55).cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

        let fontSize = CGFloat(min(width, height)) * 0.09
        let font = UIFont.systemFont(ofSize: fontSize, weight: .semibold)
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.lineBreakMode = .byWordWrapping
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: UIColor.white,
            .paragraphStyle: paragraph,
        ]
        let attributed = NSAttributedString(string: text, attributes: attrs)

        let padding: CGFloat = 48
        let maxWidth = CGFloat(width) - padding * 2
        let bounding = attributed.boundingRect(with: CGSize(width: maxWidth, height: CGFloat(height)), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)

        let x = (CGFloat(width) - bounding.width) / 2
        let y = (CGFloat(height) - bounding.height) / 2
        attributed.draw(with: CGRect(x: x, y: y, width: bounding.width, height: bounding.height), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
    }
}

// MARK: - AVPictureInPictureControllerDelegate

extension PipSubtitleController: AVPictureInPictureControllerDelegate {
    func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        isPipActive = true
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        isPipActive = false
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        // The app UI is always visible; nothing to restore.
        completionHandler(true)
    }
}

// MARK: - AVPictureInPictureSampleBufferPlaybackDelegate

extension PipSubtitleController: AVPictureInPictureSampleBufferPlaybackDelegate {
    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        setPlaying playing: Bool
    ) {
        // Live content — ignore playback state changes.
    }

    func pictureInPictureControllerTimeRangeForPlayback(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> CMTimeRange {
        // Live content: infinite duration.
        CMTimeRange(start: .zero, duration: .positiveInfinity)
    }

    func pictureInPictureControllerIsPlaybackPaused(
        _ pictureInPictureController: AVPictureInPictureController
    ) -> Bool {
        false
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        didTransitionToRenderSize newRenderSize: CMVideoDimensions
    ) {}

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        skipByInterval skipInterval: CMTime
    ) async {}
}
