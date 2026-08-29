import ActivityKit
import SwiftUI
import WidgetKit

/// Renders the live subtitle translation on the Lock Screen and in the
/// Dynamic Island while the pipeline is listening.
struct SubtitleLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveSubtitleAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.75))
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.state.sourceLanguage.uppercased(), systemImage: "text.bubble.fill")
                        .font(.caption.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.targetLanguage.uppercased())
                        .font(.caption.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(displayText(context))
                        .font(.headline)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
            } compactLeading: {
                Image(systemName: "text.bubble.fill")
            } compactTrailing: {
                Image(systemName: "waveform")
            } minimal: {
                Image(systemName: "text.bubble.fill")
            }
            .keylineTint(Color.accentColor)
        }
    }

    /// Prefer the translation; fall back to the original while translating.
    private func displayText(_ context: ActivityViewContext<LiveSubtitleAttributes>) -> String {
        if !context.state.translatedText.isEmpty {
            return context.state.translatedText
        }
        return context.state.originalText
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<LiveSubtitleAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(context.state.sourceLanguage.uppercased(), systemImage: "text.bubble.fill")
                    .font(.caption.weight(.semibold))
                Spacer()
                Text(context.state.targetLanguage.uppercased())
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(.secondary)

            Text(displayText)
                .font(.headline)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .multilineTextAlignment(.leading)

            if !context.state.originalText.isEmpty && context.state.translatedText != context.state.originalText {
                Text(context.state.originalText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(12)
    }

    private var displayText: String {
        if !context.state.translatedText.isEmpty {
            return context.state.translatedText
        }
        return context.state.originalText
    }
}
