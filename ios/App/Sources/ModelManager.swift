import Foundation

/// Downloads whisper.cpp ggml models from HuggingFace on demand and caches them
/// in Application Support. Models are too large to bundle (tiny ≈ 75 MB,
/// base ≈ 142 MB), so the first run prompts the user to download.
@MainActor
final class ModelManager: NSObject, ObservableObject {
    enum ModelState: Equatable {
        case notDownloaded
        case downloading(progress: Double)
        case ready(url: URL)
        case failed(String)
    }

    @Published private(set) var states: [String: ModelState] = [:]

    static let shared = ModelManager()

    private static var modelsDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("Models", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Local URL for a model, or `nil` if it hasn't been downloaded yet.
    func localURL(for option: AppSettings.WhisperModelOption) -> URL? {
        let url = Self.modelsDirectory.appendingPathComponent(option.fileName)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func state(for option: AppSettings.WhisperModelOption) -> ModelState {
        if let url = localURL(for: option) { return .ready(url: url) }
        return states[option.id] ?? .notDownloaded
    }

    func download(_ option: AppSettings.WhisperModelOption) {
        guard localURL(for: option) == nil else { return }
        states[option.id] = .downloading(progress: 0)

        let destination = Self.modelsDirectory.appendingPathComponent(option.fileName)
        let task = URLSession.shared.downloadTask(with: option.downloadURL) { [weak self] tempURL, _, error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    self.states[option.id] = .failed(error.localizedDescription)
                    return
                }
                guard let tempURL else {
                    self.states[option.id] = .failed("İndirme tamamlanamadı")
                    return
                }
                do {
                    try FileManager.default.moveItem(at: tempURL, to: destination)
                    self.states[option.id] = .ready(url: destination)
                } catch {
                    // Resume/overwrite case: destination may exist from an earlier attempt.
                    try? FileManager.default.removeItem(at: destination)
                    do {
                        try FileManager.default.moveItem(at: tempURL, to: destination)
                        self.states[option.id] = .ready(url: destination)
                    } catch {
                        self.states[option.id] = .failed(error.localizedDescription)
                    }
                }
            }
        }
        // Progress tracking requires a delegate; with the closure API we can only
        // report indeterminate progress. A future refinement can switch to
        // URLSessionDownloadDelegate for byte-level progress.
        tasks[option.id] = task
        task.resume()
    }

    private var tasks: [String: URLSessionDownloadTask] = [:]

    func cancel(_ option: AppSettings.WhisperModelOption) {
        tasks[option.id]?.cancel()
        tasks[option.id] = nil
        states[option.id] = .notDownloaded
    }

    func clearAllModels() {
        for option in AppSettings.whisperModelOptions {
            cancel(option)
            if let url = localURL(for: option) {
                try? FileManager.default.removeItem(at: url)
            }
            states[option.id] = .notDownloaded
        }
    }
}
