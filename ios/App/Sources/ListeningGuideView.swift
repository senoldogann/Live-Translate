import SwiftUI

/// First-launch sheet that distinguishes the two audio flows and lists the
/// three concrete steps required for video subtitles. Kept minimal and
/// data-driven from `ListeningGuide` so the copy is unit-testable.
struct ListeningGuideView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Mikrofon modu") {
                        Text("Yanınızdaki konuşmayı çevirir")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Video sesi") {
                        Text("Yayın (broadcast) akışı gerekir")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                } footer: {
                    Text(ListingGuideCopy.flowExplanation)
                }

                Section {
                    ForEach(Array(ListingGuideCopy.broadcastSteps.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .top, spacing: 12) {
                            Text("\\(index + 1)")
                                .font(.caption.bold())
                                .frame(width: 22, height: 22)
                                .background(Circle().fill(Color.accentColor.opacity(0.2)))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(step.title)
                                    .font(.subheadline.weight(.medium))
                                Text(step.detail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Video altyazısı için 3 adım")
                }
            }
            .navigationTitle("Nasıl çalışır")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Bitti") { dismiss() }
                }
            }
        }
    }
}

/// Thin copy indirection so the sheet and the pure logic share one source of
/// truth (and `ListeningGuide` stays importable from tests without SwiftUI).
enum ListingGuideCopy {
    static let flowExplanation = ListeningGuide.flowExplanation
    static let broadcastSteps = ListeningGuide.broadcastSteps
}
