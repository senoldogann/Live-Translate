import AVFoundation
import Foundation
import LiveTranslateCore

/// Captures microphone audio and delivers mono Float32 chunks at 16 kHz —
/// the input format expected by whisper.cpp.
///
/// Converts whatever the hardware provides (typically 44.1/48 kHz, interleaved
/// or non-interleaved) using `AVAudioConverter`, then down-mixes to mono.
public final class AudioSessionManager {
    public enum AudioError: Error, LocalizedError {
        case permissionDenied
        case engineSetupFailed(String)
        case engineStartFailed(String)

        public var errorDescription: String? {
            switch self {
            case .permissionDenied:
                return "Mikrofon izni verilmedi. Ayarlar'dan izin verin."
            case .engineSetupFailed(let message):
                return "Ses motoru kurulamadı: \(message)"
            case .engineStartFailed(let message):
                return "Ses yakalama başlatılamadı: \(message)"
            }
        }
    }

    public static let targetSampleRate: Double = 16000

    private let engine = AVAudioEngine()
    private let targetFormat: AVAudioFormat
    private var isRunning = false

    /// Called on a background thread with mono Float32 samples at 16 kHz.
    public var onAudioChunk: (([Float]) -> Void)?

    public init() throws {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Self.targetSampleRate,
            channels: 1,
            interleaved: false
        ) else {
            throw AudioError.engineSetupFailed("16kHz mono format oluşturulamadı")
        }
        self.targetFormat = format
    }

    // MARK: - Permission

    /// Requests microphone permission. Returns `true` when recording is allowed.
    public static func requestPermission() async -> Bool {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            return true
        case .undetermined:
            return await withCheckedContinuation { continuation in
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        case .denied:
            return false
        @unknown default:
            return false
        }
    }

    public static var hasPermission: Bool {
        AVAudioSession.sharedInstance().recordPermission == .granted
    }

    // MARK: - Capture

    public func start() throws {
        guard !isRunning else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch {
            throw AudioError.engineSetupFailed(error.localizedDescription)
        }

        let inputNode = engine.inputNode
        let inputFormat = inputNode.inputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
            throw AudioError.engineSetupFailed("Giriş cihazı formatı alınamadı")
        }

        let converter = AVAudioConverter(from: inputFormat, to: targetFormat)
        guard let converter else {
            throw AudioError.engineSetupFailed("Ses dönüştürücü oluşturulamadı")
        }

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            guard let self, let chunk = Self.convert(buffer, using: converter, to: self.targetFormat) else { return }
            let mono = PCMUtils.toMono(samples: chunk, channels: Int(self.targetFormat.channelCount))
            self.onAudioChunk?(mono)
        }

        engine.prepare()
        do {
            try engine.start()
            isRunning = true
        } catch {
            inputNode.removeTap(onBus: 0)
            throw AudioError.engineStartFailed(error.localizedDescription)
        }
    }

    public func stop() {
        guard isRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        isRunning = false
    }

    // MARK: - Conversion

    /// Converts a buffer to the target format (Float32 mono 16 kHz), returning
    /// the interleaved-ish sample plane (single channel) as `[Float]`.
    private static func convert(
        _ buffer: AVAudioPCMBuffer,
        using converter: AVAudioConverter,
        to format: AVAudioFormat
    ) -> [Float]? {
        guard buffer.frameLength > 0 else { return [] }
        let ratio = buffer.format.sampleRate / format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }

        var allSamples: [Float] = []
        var isFirstPass = true

        let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
            if isFirstPass {
                isFirstPass = false
                outStatus.pointee = .haveData
                return buffer
            }
            outStatus.pointee = .endOfStream
            return nil
        }

        var conversionError: NSError?
        let status = converter.convert(to: out, error: &conversionError, withInputFrom: inputBlock)
        guard status == .haveData || status == .inputRanDry, let data = out.floatChannelData else {
            return nil
        }

        let frames = Int(out.frameLength)
        let channels = Int(out.format.channelCount)
        allSamples.reserveCapacity(frames * channels)
        for frame in 0..<frames {
            for channel in 0..<channels {
                allSamples.append(data[channel][frame])
            }
        }
        return allSamples
    }
}
