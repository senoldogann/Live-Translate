import Combine
import Foundation
import LiveTranslateCore
import SwiftUI

/// Bridges the `SubtitlePipeline` (and its `LiveSubtitleModel`) to SwiftUI.
@MainActor
final class SubtitleViewModel: ObservableObject {
    @Published var originalText = ""
    @Published var translatedText = ""
    @Published var isFinal = true
    @Published var isListening = false
    @Published var phase: SubtitlePipeline.Phase = .idle

    let pipeline: SubtitlePipeline
    let settings: ObservableSettings

    private var cancellables = Set<AnyCancellable>()

    init(pipeline: SubtitlePipeline, settings: ObservableSettings) {
        self.pipeline = pipeline
        self.settings = settings
        pipeline.model.onUpdate = { [weak self] model in
            Task { @MainActor in
                self?.sync(from: model)
            }
        }
        pipeline.$phase
            .receive(on: DispatchQueue.main)
            .sink { [weak self] phase in
                self?.phase = phase
            }
            .store(in: &cancellables)
    }

    convenience init() {
        let settings = ObservableSettings()
        self.init(pipeline: SubtitlePipeline(settings: settings), settings: settings)
    }

    func toggleListening() {
        if isListening {
            pipeline.stop()
        } else {
            Task { await pipeline.start() }
        }
    }

    func clearTranscript() {
        pipeline.model.clear()
    }

    private func sync(from model: LiveSubtitleModel) {
        originalText = model.originalText
        translatedText = model.translatedText
        isFinal = model.isFinal
        isListening = model.isListening
    }
}
