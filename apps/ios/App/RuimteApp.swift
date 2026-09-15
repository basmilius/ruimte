import SwiftUI

@main
struct RuimteApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @State private var runtime = AppRuntime()

    var body: some Scene {
        WindowGroup {
            AppHome(runtime: runtime)
        }
    }
}
