import Foundation

/// Translation backend abstraction. Phase 1 ships with a passthrough provider
/// (original text is shown as-is); the cloud client (Phase 3) will implement
/// this protocol over WebSocket to the shared LTS server.
public protocol TranslationProviding {
    /// Translates a source segment. `isFinal` lets providers pick fast (partial)
    /// vs. quality (final) translation modes, mirroring the macOS engine.
    func translate(_ text: String, isFinal: Bool) async -> String
}

/// Phase 1: no translation backend yet — returns the original text unchanged.
/// Keeps the pipeline wiring in place so the cloud client drops in without
/// touching the pipeline.
public struct PassthroughTranslationProvider: TranslationProviding {
    public init() {}

    public func translate(_ text: String, isFinal: Bool) async -> String {
        text
    }
}
