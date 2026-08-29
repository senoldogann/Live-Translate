import LiveTranslateCore
import SwiftUI
import UIKit

/// On-device diagnostics: renders the pipeline's DebugLog so a "listening but
/// no subtitles" report can be traced to the failing link (mic permission,
/// VAD, whisper output, language filter, broadcast relay).
struct DiagnosticsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var entries: [DebugLog.Entry] = DebugLog.shared.entries

    private let timer = Timer.publish(every: 1.0, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Nasıl okunur")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text("• \"VAD: SESSİZ/eşik altı\" sürekliyse mikrofon seviyesi düşük ya da konuşulmuyor\n• \"VAD: ses\" var ama whisper boş dönüyorsa tanıma sorunu\n• \"DİL UYUMSUZLUĞU\" görünüyorsa Ayarlar'da kaynak dili değiştirin\n• Yayın modunda \"yayın köprüsü: segment yok\" → LTS ayarlarını kontrol edin")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                    Divider()

                    ForEach(entries.indices, id: \.self) { index in
                        let entry = entries[index]
                        HStack(alignment: .top, spacing: 8) {
                            Text(timeString(entry.timestamp))
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .frame(width: 76, alignment: .leading)
                            Text(entry.message)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                        }
                    }
                }
                .padding()
            }
            .background(Color.black.opacity(0.9))
            .navigationTitle("Tanılama")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Kapat") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        shareLog()
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }
            .onReceive(timer) { _ in
                entries = DebugLog.shared.entries
            }
        }
        .preferredColorScheme(.dark)
    }

    private func timeString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter.string(from: date)
    }

    private func shareLog() {
        let controller = UIActivityViewController(
            activityItems: [DebugLog.shared.renderedText()],
            applicationActivities: nil
        )
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let root = scene.windows.first?.rootViewController {
            root.present(controller, animated: true)
        }
    }
}
