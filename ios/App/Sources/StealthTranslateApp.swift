import SwiftUI

@main
struct StealthTranslateApp: App {
    @StateObject private var viewModel = SubtitleViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(viewModel)
                .preferredColorScheme(.dark)
        }
    }
}
