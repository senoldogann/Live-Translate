import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: ObservableSettings
    @StateObject private var modelManager = ModelManager.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                modelSection
                languageSection
                appearanceSection
                translationSection
                cloudSection
                aboutSection
            }
            .navigationTitle("Ayarlar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Bitti") { dismiss() }
                }
            }
        }
    }

    // MARK: - Model

    private var modelSection: some View {
        Section {
            ForEach(AppSettings.whisperModelOptions) { option in
                modelRow(option)
            }
        } header: {
            Text("Whisper Modeli")
        } footer: {
            Text("Konuşma tanıma cihazınızda çalışır. İlk kullanımda bir model indirilir (~75–142 MB). Daha büyük modeller daha doğru ama daha yavaştır.")
        }
    }

    private func modelRow(_ option: AppSettings.WhisperModelOption) -> some View {
        let state = modelManager.state(for: option)
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(option.displayName)
                if case .ready = state {
                    Text("İndirildi")
                        .font(.caption)
                        .foregroundStyle(.green)
                } else if case .downloading = state {
                    Text("İndiriliyor…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if case .failed(let message) = state {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
            }
            Spacer()
            if case .ready = state {
                if settings.whisperModel == option.id {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.accentColor)
                } else {
                    Button("Kullan") { settings.whisperModel = option.id }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            } else if case .downloading = state {
                ProgressView()
            } else {
                Button("İndir") {
                    modelManager.download(option)
                    settings.whisperModel = option.id
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
    }

    // MARK: - Language

    private var languageSection: some View {
        Group {
            Section {
                Picker("Konuşma dili", selection: $settings.sourceLanguage) {
                    ForEach(AppSettings.languageOptions, id: \.id) { lang in
                        Text(lang.displayName).tag(lang.id)
                    }
                }
                .onChange(of: settings.sourceLanguage) { _ in
                    settings.syncToAppGroup()
                }
            } header: {
                Text("Dil")
            } footer: {
                Text("Otomatik algıla seçilirse dil her cümlede tespit edilir. Belirli bir dil seçerseniz başka diller yoksayılır.")
            }

            Section {
                Picker("Çeviri dili", selection: $settings.targetLanguage) {
                    ForEach(AppSettings.languageOptions.filter { $0.id != "auto" }, id: \.id) { lang in
                        Text(lang.displayName).tag(lang.id)
                    }
                }
                .onChange(of: settings.targetLanguage) { _ in
                    settings.syncToAppGroup()
                }
            } header: {
                Text("Hedef Dil")
            } footer: {
                Text("Hedef dil, kilit ekranı canlı etkinliğinde gösterilir. Çeviri bulut modunda etkinleşince kullanılacak.")
            }
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        Section("Görünüm") {
            VStack {
                HStack {
                    Text("Yazı boyutu")
                    Spacer()
                    Text("\(Int(settings.fontSize))")
                        .foregroundStyle(.secondary)
                }
                Slider(value: $settings.fontSize, in: 18...44, step: 1)
            }
            VStack {
                HStack {
                    Text("Arka plan koyuluğu")
                    Spacer()
                    Text("\(Int(settings.backgroundOpacity * 100))%")
                        .foregroundStyle(.secondary)
                }
                Slider(value: $settings.backgroundOpacity, in: 0.2...0.9)
            }
        }
    }

    // MARK: - Translation

    private var translationSection: some View {
        Section {
            Picker("Çeviri sağlayıcısı", selection: $settings.translationProvider) {
                Text("Geçiş (orijinal metin)").tag("passthrough")
                Text("Bulut (LTS sunucusu)").tag("lts")
            }
        } header: {
            Text("Çeviri")
        } footer: {
            Text("Bulut modu, cihaz sesi için yayın (broadcast) altyapısını ve bulut çevirisini etkinleştirir. Sunucu adresini aşağıdan ayarlayın.")
        }
    }

    // MARK: - Cloud / Broadcast

    @State private var ltsServerURL: String = ""
    @State private var ltsAPIKey: String = ""

    private var cloudSection: some View {
        Section {
            TextField("Sunucu adresi", text: $ltsServerURL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("API anahtarı (opsiyonel)", text: $ltsAPIKey)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        } header: {
            Text("Bulut & Yayın")
        } footer: {
            Text("Video sesi için 3 adım: \(ListeningGuide.broadcastSteps.enumerated().map { "\($0.offset + 1). \($0.element.title): \($0.element.detail)" }.joined(separator: "  •  "))")
        }
        .onAppear {
            ltsServerURL = settings.ltsServerURL
            ltsAPIKey = settings.ltsAPIKey
        }
        .onChange(of: ltsServerURL) { newValue in
            settings.ltsServerURL = newValue
            settings.syncToAppGroup()
        }
        .onChange(of: ltsAPIKey) { newValue in
            settings.ltsAPIKey = newValue
            settings.syncToAppGroup()
        }
        .onDisappear {
            settings.syncToAppGroup()
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        Section("Hakkında") {
            LabeledContent("Sürüm", value: "0.1.0")
            LabeledContent("Gizlilik", value: "Ses cihazdan çıkmaz")
            LabeledContent("Altyapı", value: "whisper.cpp (on-device)")
        }
    }
}
