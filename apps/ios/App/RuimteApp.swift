import BackgroundTasks
import RuimteShared
import SwiftUI
import UIKit

@main
struct RuimteApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @State private var runtime = NotificationAppDelegate.runtime

    init() {
        CrashReports.start()
        AppUsage.start(runtime: NotificationAppDelegate.runtime)
        // A badge counts what waits on you, so it wears the waiting color rather than the system's red.
        UITabBarItem.appearance().badgeColor = MobileStyle.statusNeedsYouColor
        UITabBarItem.appearance().setBadgeTextAttributes([.foregroundColor: MobileStyle.surfaceColor], for: .normal)
    }

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
