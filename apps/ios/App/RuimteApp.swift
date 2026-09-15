import SwiftUI

@main
struct RuimteApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @State private var runtime = AppRuntime()

    var body: some Scene {
        WindowGroup {
            AppHome(runtime: runtime)
                .tint(MobileStyle.accent)
                .toggleStyle(SystemToggleStyle())
        }
    }
}

struct SystemToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Toggle(configuration).toggleStyle(.automatic).tint(nil)
    }
}
