import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var viewModel: SubtitleViewModel
    @State private var showSettings = false
    @State private var showHistory = false
    @State private var showDiagnostics = false

    var body: some View {
        ZStack {
            // Ambient background.
            LinearGradient(
                colors: [Color(red: 0.08, green: 0.06, blue: 0.18), .black],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack {
                header
                Spacer()

                if !viewModel.isListening && viewModel.originalText.isEmpty {
                    idlePrompt
                } else {
                    SubtitleOverlayView(
                        originalText: viewModel.originalText,
                        translatedText: viewModel.translatedText,
                        isFinal: viewModel.isFinal,
                        fontSize: viewModel.settings.fontSize,
                        backgroundOpacity: viewModel.settings.backgroundOpacity
                    )
                    .padding(.bottom, 40)
                }

                Spacer()
                if viewModel.settings.translationProvider == "lts" {
                    broadcastStatusBar
                }
                statusBar
                controls
            }
            .padding()
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(settings: viewModel.settings)
                .environmentObject(viewModel)
        }
        .sheet(isPresented: $showHistory) {
            TranscriptHistoryView(viewModel: viewModel)
        }
        .sheet(isPresented: $showDiagnostics) {
            DiagnosticsView()
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Stealth Translate")
                    .font(.title2.bold())
                Text("Canlı altyazı ve çeviri")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                showHistory = true
            } label: {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.title3)
            }
            .accessibilityLabel("Geçmiş")
            Button {
                showDiagnostics = true
            } label: {
                Image(systemName: "stethoscope")
                    .font(.title3)
            }
            .accessibilityLabel("Tanılama")
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape.fill")
                    .font(.title3)
            }
            .accessibilityLabel("Ayarlar")
        }
    }

    private var idlePrompt: some View {
        VStack(spacing: 12) {
            Image(systemName: "waveform.and.mic")
                .font(.system(size: 56))
                .foregroundStyle(.secondary)
            Text("Dinlemek için başlat'a dokunun")
                .font(.headline)
                .foregroundStyle(.secondary)
            Text("Konuşmalar cihazınızda işlenir")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.bottom, 40)
    }

    private var statusBar: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(viewModel.isListening ? Color.green : Color.gray)
                .frame(width: 8, height: 8)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            if viewModel.isListening && !viewModel.isFinal {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 4)
    }

    private var statusText: String {
        switch viewModel.phase {
        case .idle:
            return "Hazır"
        case .loadingModel:
            return "Model yükleniyor…"
        case .listening:
            return viewModel.isListening ? "Dinleniyor" : "Dinleme durdu"
        case .failed(let message):
            return message
        }
    }

    private var controls: some View {
        HStack(spacing: 24) {
            Button {
                viewModel.toggleListening()
            } label: {
                Image(systemName: viewModel.isListening ? "stop.fill" : "play.fill")
                    .font(.system(size: 22, weight: .bold))
                    .frame(width: 64, height: 64)
                    .background(
                        Circle()
                            .fill(viewModel.isListening ? Color.red.opacity(0.85) : Color.accentColor)
                    )
                    .foregroundStyle(.white)
            }
            .accessibilityLabel(viewModel.isListening ? "Dinlemeyi durdur" : "Dinlemeyi başlat")
            .disabled(viewModel.phase == .loadingModel)
            .disabled(viewModel.broadcast.isBroadcasting)

            if viewModel.broadcast.isBroadcasting {
                // Broadcasting — show the stop toggle + status instead.
                broadcastButton
            } else {
                if !viewModel.originalText.isEmpty {
                    Button {
                        viewModel.clearTranscript()
                    } label: {
                        Image(systemName: "trash")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityLabel("Altyazıyı temizle")
                }
            }
        }
    }

    private var broadcastButton: some View {
        VStack(spacing: 4) {
            BroadcastPickerView()
                .frame(width: 64, height: 64)
                .clipShape(Circle())
                .overlay(
                    Circle().stroke(Color.accentColor.opacity(0.6), lineWidth: 2)
                )
            Text("Yayın")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .accessibilityLabel("Cihaz sesini yayınla (ekran kaydı başlatıcı)")
    }

    private var broadcastStatusBar: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .foregroundStyle(viewModel.broadcast.isBroadcasting ? Color.red : Color.secondary)
                Text(viewModel.broadcast.isBroadcasting ? "Yayın aktif — cihaz sesi çevriliyor" : "Yayın hazır")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            if let error = viewModel.broadcast.lastError {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(Color.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 4)
    }
}
