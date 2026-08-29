import LiveTranslateCore
import SwiftUI
import UIKit

/// Transcript history: final segments grouped by day, with TXT/SRT export via
/// the system share sheet.
struct TranscriptHistoryView: View {
    @ObservedObject var viewModel: SubtitleViewModel
    @Environment(\.dismiss) private var dismiss

    private let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        formatter.locale = Locale(identifier: "tr_TR")
        return formatter
    }()

    private let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        formatter.locale = Locale(identifier: "tr_TR")
        return formatter
    }()

    var body: some View {
        NavigationStack {
            Group {
                if history.isEmpty {
                    emptyState
                } else {
                    List {
                        ForEach(dayGroups, id: \.key) { group in
                            Section(header: Text(group.key)) {
                                ForEach(group.segments, id: \.self) { segment in
                                    segmentRow(segment)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Geçmiş")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Kapat") { dismiss() }
                }
                if !history.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Menu {
                            Button {
                                share(exportTXT())
                            } label: {
                                Label("TXT olarak paylaş", systemImage: "doc.plaintext")
                            }
                            Button {
                                share(exportSRT())
                            } label: {
                                Label("SRT olarak paylaş", systemImage: "captions.bubble")
                            }
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                }
            }
        }
    }

    // MARK: - Data

    private var history: [SubtitleSegment] {
        viewModel.pipeline.model.history
    }

    private var dayGroups: [(key: String, segments: [SubtitleSegment])] {
        let grouped = Dictionary(grouping: history) { segment in
            dateFormatter.string(from: Date(timeIntervalSince1970: segment.timestamp))
        }
        return grouped.keys.sorted().map { key in
            (key: key, segments: grouped[key] ?? [])
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "text.bubble")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Henüz geçmiş yok")
                .font(.headline)
            Text("Dinleme başlatın; tamamlanan cümleler burada listelenir.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
    }

    private func segmentRow(_ segment: SubtitleSegment) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(timeFormatter.string(from: Date(timeIntervalSince1970: segment.timestamp)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(segment.source == "broadcast" ? "Yayın" : "Mikrofon")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                    .foregroundStyle(.secondary)
            }
            if !segment.translated.isEmpty {
                Text(segment.translated)
                    .font(.subheadline.weight(.medium))
                Text(segment.original)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text(segment.original)
                    .font(.subheadline.weight(.medium))
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Export

    private func exportTXT() -> String {
        TranscriptExporter.plainText(history)
    }

    private func exportSRT() -> String {
        TranscriptExporter.srt(history)
    }

    private func share(_ content: String) {
        let controller = UIActivityViewController(activityItems: [content], applicationActivities: nil)
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let root = scene.windows.first?.rootViewController {
            root.present(controller, animated: true)
        }
    }
}
