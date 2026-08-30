import XCTest
@testable import Stealth_Subtitle_Translator

final class ListeningGuideTests: XCTestCase {
    // MARK: - statusHint

    func testNoHintWhenNotListening() {
        XCTAssertNil(ListeningGuide.statusHint(
            isListening: false,
            isBroadcasting: false,
            translationProvider: "lts"
        ))
    }

    func testNoHintWhileBroadcasting() {
        XCTAssertNil(ListeningGuide.statusHint(
            isListening: true,
            isBroadcasting: true,
            translationProvider: "lts"
        ))
    }

    func testNoHintInPassthroughMode() {
        XCTAssertNil(ListeningGuide.statusHint(
            isListening: true,
            isBroadcasting: false,
            translationProvider: "passthrough"
        ))
    }

    func testHintWhenListeningWithoutBroadcastInCloudMode() {
        let hint = ListeningGuide.statusHint(
            isListening: true,
            isBroadcasting: false,
            translationProvider: "lts"
        )
        XCTAssertNotNil(hint)
        XCTAssertTrue(hint!.contains("yayın"), "hint must steer the user to the broadcast flow")
        XCTAssertTrue(hint!.contains("sunucu"), "hint must mention the server address step")
    }

    // MARK: - first launch

    func testFirstLaunchGuideShownOnlyOnce() {
        XCTAssertTrue(ListeningGuide.shouldShowFirstLaunchGuide(hasSeenGuide: false))
        XCTAssertFalse(ListeningGuide.shouldShowFirstLaunchGuide(hasSeenGuide: true))
    }

    // MARK: - steps copy

    func testBroadcastStepsHaveThreeConcreteSteps() {
        XCTAssertEqual(ListeningGuide.broadcastSteps.count, 3)
        XCTAssertTrue(ListeningGuide.broadcastSteps[0].detail.contains("lts_server.py"))
        XCTAssertTrue(ListeningGuide.broadcastSteps[1].detail.contains("ws://"))
        XCTAssertTrue(ListeningGuide.broadcastSteps[2].detail.contains("LiveTranslateBroadcast"))
    }

    func testFlowExplanationDistinguishesTheTwoFlows() {
        XCTAssertTrue(ListeningGuide.flowExplanation.contains("Mikrofon"))
        XCTAssertTrue(ListeningGuide.flowExplanation.contains("broadcast"))
    }
}
