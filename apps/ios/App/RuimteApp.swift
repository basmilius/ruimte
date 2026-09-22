import BackgroundTasks
import SwiftUI

@main
struct RuimteApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @State private var runtime = NotificationAppDelegate.runtime

    var body: some Scene {
        WindowGroup {
            AppHome(runtime: runtime)
                .foregroundStyle(MobileStyle.text)
                .modifier(MobilePageSurface())
                .tint(MobileStyle.accent)
                .toggleStyle(SystemToggleStyle())
        }
        .backgroundTask(.appRefresh(UsageWidgetRefresh.identifier)) { await UsageWidgetRefresh.run() }
    }
}

enum UsageWidgetRefresh {
    static let identifier = "app.ruimte.mobile.usage-widget"

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = .now.addingTimeInterval(30 * 60)
        BGTaskScheduler.shared.submitTaskRequest(request) { _ in }
    }

    @MainActor static func run() async {
        schedule()
        await NotificationAppDelegate.runtime.refreshUsageWidgets()
    }
}

struct SystemToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Toggle(configuration).toggleStyle(.automatic).tint(nil)
    }
}
