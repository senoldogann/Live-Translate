import Foundation
import SwiftUI

/// User preferences persisted via `@AppStorage` (UserDefaults).
enum AppSettings {
    // MARK: - Keys

    enum Key {
        static let sourceLanguage = "settings.sourceLanguage"
        static let targetLanguage = "settings.targetLanguage"
        static let whisperModel = "settings.whisperModel"
        static let fontSize = "settings.fontSize"
        static let backgroundOpacity = "settings.backgroundOpacity"
        static let translationProvider = "settings.translationProvider"
        static let autoStartListening = "settings.autoStartListening"
    }

    // MARK: - Whisper model options

    struct WhisperModelOption: Identifiable, Hashable {
        let id: String          // file name stem, e.g. "ggml-tiny"
        let displayName: String
        let fileName: String    // "ggml-tiny.bin"
        let sizeMB: Int
        let downloadURL: URL
    }

    static let whisperModelOptions: [WhisperModelOption] = [
        WhisperModelOption(
            id: "tiny",
            displayName: "Tiny (hızlı, ~75 MB)",
            fileName: "ggml-tiny.bin",
            sizeMB: 75,
            downloadURL: URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin")!
        ),
        WhisperModelOption(
            id: "base",
            displayName: "Base (dengeli, ~142 MB)",
            fileName: "ggml-base.bin",
            sizeMB: 142,
            downloadURL: URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin")!
        )
    ]

    // MARK: - Language options (subset used for speech recognition + translation)

    static let languageOptions: [(id: String, displayName: String)] = [
        ("auto", "Otomatik algıla"),
        ("tr", "Türkçe"),
        ("en", "English"),
        ("de", "Deutsch"),
        ("fr", "Français"),
        ("es", "Español"),
        ("it", "Italiano"),
        ("ru", "Русский"),
        ("ar", "العربية"),
        ("ja", "日本語"),
        ("ko", "한국어"),
        ("zh", "中文")
    ]

    // MARK: - Defaults

    static let defaultSourceLanguage = "auto"
    static let defaultTargetLanguage = "tr"
    static let defaultWhisperModel = "tiny"
    static let defaultFontSize: Double = 26
    static let defaultBackgroundOpacity: Double = 0.55
    static let defaultTranslationProvider = "passthrough"

    static func displayName(forLanguage id: String) -> String {
        languageOptions.first { $0.id == id }?.displayName ?? id
    }

    static func modelOption(forID id: String) -> WhisperModelOption? {
        whisperModelOptions.first { $0.id == id } ?? whisperModelOptions.first
    }
}

/// Observable settings object shared with the UI. Backed by UserDefaults.
final class ObservableSettings: ObservableObject {
    @AppStorage(AppSettings.Key.sourceLanguage)
    var sourceLanguage: String = AppSettings.defaultSourceLanguage

    @AppStorage(AppSettings.Key.targetLanguage)
    var targetLanguage: String = AppSettings.defaultTargetLanguage

    @AppStorage(AppSettings.Key.whisperModel)
    var whisperModel: String = AppSettings.defaultWhisperModel

    @AppStorage(AppSettings.Key.fontSize)
    var fontSize: Double = AppSettings.defaultFontSize

    @AppStorage(AppSettings.Key.backgroundOpacity)
    var backgroundOpacity: Double = AppSettings.defaultBackgroundOpacity

    @AppStorage(AppSettings.Key.translationProvider)
    var translationProvider: String = AppSettings.defaultTranslationProvider

    @AppStorage(AppSettings.Key.autoStartListening)
    var autoStartListening: Bool = false
}
