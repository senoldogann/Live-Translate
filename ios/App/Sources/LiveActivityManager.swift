import ActivityKit
import Foundation

/// Starts, updates and ends the Lock Screen / Dynamic Island Live Activity
/// from the subtitle pipeline.
///
/// Live Activities have a system-enforced update budget, so partial (streaming)
/// updates are throttled to `partialUpdateInterval`; final sentences always
/// update immediately. `NSSupportsLiveActivitiesFrequentUpdates` in the app's
/// Info.plist raises the budget on iOS 16.2+.
///
/// Note: uses the async ActivityKit APIs (iOS 16.2+). The iOS 16.1 synchronous
/// variants were removed from the SDK, so the app's deployment target is 16.2.
@MainActor
final class LiveActivityManager {
    static let shared = LiveActivityManager()

    /// Minimum gap between two partial (non-final) updates.
    private let partialUpdateInterval: TimeInterval = 2.0

    private var currentActivity: Activity<LiveSubtitleAttributes>?
    private var lastUpdateTime = Date.distantPast

    var isActive: Bool { currentActivity != nil }

    private init() {}

    // MARK: - Lifecycle

    func start(sourceLanguage: String, targetLanguage: String) async {
        guard currentActivity == nil else { return }

        let attributes = LiveSubtitleAttributes(
            sourceLanguage: sourceLanguage,
            targetLanguage: targetLanguage
        )
        let initialState = LiveSubtitleAttributes.ContentState(
            originalText: "",
            translatedText: "",
            isFinal: true,
            sourceLanguage: sourceLanguage,
            targetLanguage: targetLanguage
        )

        do {
            currentActivity = try await Activity<LiveSubtitleAttributes>.request(
                attributes: attributes,
                contentState: initialState,
                pushType: nil
            )
        } catch {
            // Live Activities can be disabled by the user (Settings → Live
            // Activities) or unavailable in the current context. In-app
            // subtitles keep working regardless.
            currentActivity = nil
        }
    }

    func update(original: String, translated: String, isFinal: Bool) async {
        guard let activity = currentActivity else { return }

        let now = Date()
        if !isFinal && now.timeIntervalSince(lastUpdateTime) < partialUpdateInterval {
            return
        }

        let state = LiveSubtitleAttributes.ContentState(
            originalText: original,
            translatedText: translated,
            isFinal: isFinal,
            sourceLanguage: activity.attributes.sourceLanguage,
            targetLanguage: activity.attributes.targetLanguage
        )
        lastUpdateTime = now
        await activity.update(using: state)
    }

    func end() async {
        guard let activity = currentActivity else { return }
        currentActivity = nil
        await activity.end(using: nil, dismissalPolicy: .immediate)
    }
}
