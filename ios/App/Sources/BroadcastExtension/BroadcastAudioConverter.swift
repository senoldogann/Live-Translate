import CoreMedia
import Foundation
import LiveTranslateCore

/// Converts ReplayKit audio `CMSampleBuffer`s into the LTS wire format:
/// mono 16 kHz int16 little-endian PCM bytes.
///
/// ReplayKit typically delivers `.audioApp` as Float32 (or Int16) at 44.1/48 kHz,
/// interleaved or non-interleaved, 1–2 channels. Audio Units are forbidden inside a
/// Broadcast Upload Extension, and `AVAudioConverter` proved unreliable (stateful)
/// for the real-time chunked broadcast stream — the first buffer converted but every
/// subsequent chunk produced zero output. So we decode each buffer deterministically
/// by hand: de-interleave → decode to Float32 → down-mix → `PCMUtils.resample` to
/// 16 kHz. No cached state, no black box.
final class BroadcastAudioConverter {
    private let targetSampleRate: Double = 16000

    /// TEMP DEBUG: last failure stage, set by `convert` when it bails.
    static var lastFailStage = ""

    /// No persistent state to reset (stateless), kept for API parity.
    func reset() {}

    /// Converts one CMSampleBuffer to int16 LE PCM bytes, or nil when the
    /// buffer has no audio (or the format is unsupported).
    func convert(_ sampleBuffer: CMSampleBuffer) -> Data? {
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else {
            Self.lastFailStage = "noFormatDesc"; return nil
        }
        guard let streamDesc = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else {
            Self.lastFailStage = "noASBD"; return nil
        }

        let asbd = streamDesc.pointee
        guard asbd.mSampleRate > 0, asbd.mChannelsPerFrame > 0, asbd.mBitsPerChannel > 0 else {
            Self.lastFailStage = "badASBD rate=\(asbd.mSampleRate) ch=\(asbd.mChannelsPerFrame) flags=0x\(String(asbd.mFormatFlags, radix: 16)) bits=\(asbd.mBitsPerChannel)"; return nil
        }

        let frameCount = Int(CMSampleBufferGetNumSamples(sampleBuffer))
        guard frameCount > 0 else {
            Self.lastFailStage = "zeroFrames"; return nil
        }

        let interleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let isSigned = (asbd.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0
        let bytesPerSample = Int(asbd.mBitsPerChannel) / 8
        let channelCount = Int(asbd.mChannelsPerFrame)

        // Materialize the buffer list as a local `var` so its backing storage stays
        // alive while the `UnsafeMutableAudioBufferListPointer` below is in scope.
        var sampleBufferList = AudioBufferList()
        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &sampleBufferList,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        )
        guard status == noErr else { Self.lastFailStage = "noBuffers"; return nil }

        // Build per-channel byte slices so the rest of the pipeline is pure.
        let channelBytes = Self.channelByteArrays(
            bufferList: UnsafeMutableAudioBufferListPointer(&sampleBufferList),
            interleaved: interleaved,
            channels: channelCount,
            bytesPerFrame: Int(asbd.mBytesPerFrame),
            bytesPerSample: bytesPerSample,
            frameCount: frameCount
        )
        guard !channelBytes.isEmpty else {
            Self.lastFailStage = "noChannelData"; return nil
        }

        // Decode each channel → mono Float32 at the SOURCE rate.
        let decoded = channelBytes.map {
            PCMUtils.decodeChannel(bytes: $0, bytesPerSample: bytesPerSample, isFloat: isFloat, isSigned: isSigned)
        }
        let mono = PCMUtils.averageChannels(decoded)
        guard !mono.isEmpty else {
            Self.lastFailStage = "emptyMono"; return nil
        }

        // Resample to the LTS 16 kHz target.
        let resampled = PCMUtils.resample(samples: mono, from: asbd.mSampleRate, to: targetSampleRate)
        guard !resampled.isEmpty else {
            Self.lastFailStage = "emptyResample"; return nil
        }

        // Float32 [-1, 1] → int16 LE.
        var pcm16 = [Int16](repeating: 0, count: resampled.count)
        for i in 0..<resampled.count {
            let clamped = max(-1.0, min(1.0, Double(resampled[i])))
            pcm16[i] = Int16(clamped * 32767.0)
        }
        return Data(bytes: pcm16, count: pcm16.count * 2)
    }

    // MARK: - Helpers

    /// Copies the raw PCM bytes for every channel into separate `[UInt8]` arrays
    /// (little-endian samples, per channel). Handles both interleaved and
    /// non-interleaved layouts.
    private static func channelByteArrays(
        bufferList: UnsafeMutableAudioBufferListPointer,
        interleaved: Bool,
        channels: Int,
        bytesPerFrame: Int,
        bytesPerSample: Int,
        frameCount: Int
    ) -> [[UInt8]] {
        guard bytesPerFrame > 0, bytesPerSample > 0 else { return [] }

        if interleaved {
            guard let data = bufferList[0].mData else { return [] }
            let totalBytes = Int(bufferList[0].mDataByteSize)
            let raw = Data(bytes: data, count: totalBytes)
            var out = [[UInt8]](repeating: [], count: channels)
            let stride = bytesPerFrame
            for ch in 0..<channels {
                var chBytes = [UInt8]()
                chBytes.reserveCapacity(frameCount * bytesPerSample)
                for f in 0..<frameCount {
                    let base = f * stride + ch * bytesPerSample
                    if base + bytesPerSample <= raw.count {
                        chBytes.append(contentsOf: raw[base..<(base + bytesPerSample)])
                    }
                }
                out[ch] = chBytes
            }
            return out
        } else {
            // Non-interleaved: one AudioBuffer per channel.
            let count = min(bufferList.count, channels, 2)
            var out = [[UInt8]]()
            let frames = min(frameCount, bufferList.count > 0 ? Int(bufferList[0].mDataByteSize) / bytesPerFrame : 0)
            for ch in 0..<count {
                guard let data = bufferList[ch].mData else { continue }
                let bytes = min(Int(bufferList[ch].mDataByteSize), frames * bytesPerSample)
                out.append([UInt8](Data(bytes: data, count: bytes)))
            }
            return out
        }
    }
}
