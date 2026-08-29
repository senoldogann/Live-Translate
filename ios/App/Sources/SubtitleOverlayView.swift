import SwiftUI

/// Glass panel showing the live translated subtitle (large) with the original
/// text (muted, smaller) above it. The most recently recognized word of the
/// translated line is accented for a subtle karaoke effect — the text only
/// grows, it never erases and re-types.
struct SubtitleOverlayView: View {
    let originalText: String
    let translatedText: String
    let isFinal: Bool
    let fontSize: Double
    let backgroundOpacity: Double

    var body: some View {
        VStack(spacing: 8) {
            if !originalText.isEmpty {
                KaraokeText(
                    text: originalText,
                    fontSize: fontSize * 0.6,
                    highlightLastWord: false,
                    opacity: isFinal ? 0.7 : 0.5
                )
            }

            if !translatedText.isEmpty {
                KaraokeText(
                    text: translatedText,
                    fontSize: fontSize,
                    highlightLastWord: !isFinal,
                    opacity: 1.0
                )
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.black.opacity(backgroundOpacity))
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.white.opacity(0.15), lineWidth: 1)
        )
        .padding(.horizontal, 24)
        .animation(.easeOut(duration: 0.2), value: originalText)
        .animation(.easeOut(duration: 0.2), value: translatedText)
    }
}

/// Renders text word-by-word; optionally accents the newest word.
struct KaraokeText: View {
    let text: String
    let fontSize: Double
    let highlightLastWord: Bool
    let opacity: Double

    private var words: [String] {
        text.split(separator: " ").map(String.init)
    }

    var body: some View {
        let parts = words
        HStack(spacing: 4) {
            ForEach(Array(parts.enumerated()), id: \.offset) { index, word in
                Text(word)
                    .font(.system(size: fontSize, weight: index == parts.count - 1 && highlightLastWord ? .bold : .semibold))
                    .foregroundStyle(index == parts.count - 1 && highlightLastWord
                        ? Color.accentColor.opacity(0.95)
                        : Color.white.opacity(opacity))
            }
        }
        .lineLimit(3)
        .multilineTextAlignment(.center)
    }
}

#Preview {
    ZStack {
        LinearGradient(colors: [.indigo, .black], startPoint: .top, endPoint: .bottom)
        SubtitleOverlayView(
            originalText: "Merhaba dünya nasılsın",
            translatedText: "Hello world",
            isFinal: false,
            fontSize: 26,
            backgroundOpacity: 0.55
        )
    }
}
