import AVFoundation
import CoreMedia
import Foundation

/// Converts ReplayKit audio CMSampleBuffers (typically Float32 at 44.1/48 kHz,
/// interleaved or non-interleaved, 1–2 channels) into the LTS wire format:
/// mono 16 kHz int16 little-endian PCM bytes.
///
/// Audio Units are forbidden inside a Broadcast Upload Extension, so we stick
/// with `AVAudioConverter` + manual de-interleave — both pure Core Audio and
/// well within the 50 MB budget.
final class BroadcastAudioConverter {
    private let targetSampleRate: Double = 16000
    private var cachedSource: (rate: Double, channels: UInt32, interleaved: Bool)?
    private var converter: AVAudioConverter?

    /// Flush any cached state (call in `broadcastStarted`).
    func reset() {
        cachedSource = nil
        converter = nil
    }

    /// Converts one CMSampleBuffer to int16 LE PCM bytes, or nil when the
    /// buffer has no audio (or the format is unsupported).
    func convert(_ sampleBuffer: CMSampleBuffer) -> Data? {
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else { return nil }
        guard let streamDesc = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else { return nil }

        let asbd = streamDesc.pointee
        guard asbd.mSampleRate > 0, asbd.mChannelsPerFrame > 0 else { return nil }

        // Lazily build a converter for this source format. ReplayKit keeps a
        // stable format during a broadcast, but re-check cheaply in case the
        // source changes (e.g. app switch with a different sample rate).
        let key = (rate: asbd.mSampleRate, channels: asbd.mChannelsPerFrame, interleaved: (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0)
        if converter == nil || cachedSource?.rate != key.rate || cachedSource?.channels != key.channels || cachedSource?.interleaved != key.interleaved {
            var mutableASBD = asbd
            guard let sourceFormat = AVAudioFormat(streamDescription: &mutableASBD),
                  let targetFormat = AVAudioFormat(
                      commonFormat: .pcmFormatFloat32,
                      sampleRate: targetSampleRate,
                      channels: 1,
                      interleaved: false
                  ),
                  let newConverter = AVAudioConverter(from: sourceFormat, to: targetFormat)
            else { return nil }
            cachedSource = key
            converter = newConverter
        }
        guard let converter else { return nil }

        let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frameCount > 0,
              let pcmBuffer = Self.pcmBuffer(from: sampleBuffer, asbd: asbd, frameCount: Int(frameCount))
        else { return nil }

        // Resample + down-mix to 16 kHz mono Float32.
        guard let mono = Self.convertToMono(pcmBuffer, using: converter) else { return nil }

        // Float32 [-1, 1] → int16 LE.
        var pcm16 = [Int16](repeating: 0, count: mono.count)
        for i in 0..<mono.count {
            let clamped = max(-1.0, min(1.0, Double(mono[i])))
            pcm16[i] = Int16(clamped * 32767.0)
        }
        return Data(bytes: pcm16, count: pcm16.count * 2)
    }

    // MARK: - Helpers

    /// Copies a CMSampleBuffer's audio data into an `AVAudioPCMBuffer`. The
    /// buffer copies (rather than references) the frame memory so callers can
    /// release the CMSampleBuffer immediately — important under the 50 MB cap.
    private static func pcmBuffer(
        from sampleBuffer: CMSampleBuffer,
        asbd: AudioStreamBasicDescription,
        frameCount: Int
    ) -> AVAudioPCMBuffer? {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: asbd.mSampleRate,
            channels: asbd.mChannelsPerFrame,
            interleaved: (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
        ) else { return nil }

        var blockBuffer: CMBlockBuffer?
        var bufferList = AudioBufferList()
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &bufferList,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        )
        guard status == noErr else { return nil }

        guard let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frameCount)) else { return nil }
        pcm.frameLength = AVAudioFrameCount(frameCount)

        let channels = Int(asbd.mChannelsPerFrame)
        let bufferPointer = UnsafeMutableAudioBufferListPointer(&bufferList)
        let interleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0

        if interleaved {
            guard let mData = bufferPointer[0].mData else { return nil }
            let src = mData.assumingMemoryBound(to: Float.self)
            for frame in 0..<frameCount {
                for channel in 0..<channels {
                    pcm.floatChannelData![channel][frame] = src[frame * channels + channel]
                }
            }
        } else {
            for channel in 0..<channels {
                guard let mData = bufferPointer[channel].mData else { continue }
                let src = mData.assumingMemoryBound(to: Float.self)
                for frame in 0..<frameCount {
                    pcm.floatChannelData![channel][frame] = src[frame]
                }
            }
        }
        return pcm
    }

    /// Resamples + down-mixes to mono Float32 at 16 kHz via `AVAudioConverter`.
    private static func convertToMono(
        _ source: AVAudioPCMBuffer,
        using converter: AVAudioConverter
    ) -> [Float]? {
        let targetFormat = converter.outputFormat
        let ratio = targetFormat.sampleRate / source.format.sampleRate
        let capacity = AVAudioFrameCount(Double(source.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return nil }

        var isFirstPass = true
        let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
            if isFirstPass {
                isFirstPass = false
                outStatus.pointee = .haveData
                return source
            }
            outStatus.pointee = .endOfStream
            return nil
        }

        var error: NSError?
        let status = converter.convert(to: out, error: &error, withInputFrom: inputBlock)
        guard status == .haveData, let data = out.floatChannelData, out.frameLength > 0 else { return nil }
        return Array(UnsafeBufferPointer(start: data[0], count: Int(out.frameLength)))
    }
}
