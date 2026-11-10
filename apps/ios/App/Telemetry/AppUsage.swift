import Foundation
import UIKit

/// The app's anonymous daily usage, in the builds that report crashes and nowhere else: a Debug build, the simulator,
/// tests and previews count nothing and keep no file. It follows the machines' switch (`UsageDays.counts`).
@MainActor enum AppUsage {
    /// Days only finish at midnight UTC, so an hour is soon enough and also the wait after a failed send.
    private static let flushInterval: TimeInterval = 60 * 60
    private static var days: UsageDays?
    private static var flushedAt: Date?

    static func start(runtime: AppRuntime) {
        guard CrashReports.enabled, days == nil else { return }
        let days = UsageDays(
            store: FileUsageStore(), version: AppVersion.marketing, release: true,
            signedIn: { [weak runtime] in runtime?.account != nil })
        days.load()
        self.days = days
        let center = NotificationCenter.default
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { self.days?.persist() }
        }
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { flush() }
        }
        flush()
    }

    static func count(_ counter: UsageCounter) { days?.count(counter) }

    static func screen(_ counter: UsageCounter) { days?.screen(counter) }

    static func heard(machineID: String, usageStats: Bool) {
        days?.heard(machineID: machineID, usageStats: usageStats)
    }

    static func keep(machineIDs: Set<String>) { days?.keep(machineIDs: machineIDs) }

    private static func flush() {
        guard let days else { return }
        let now = Date()
        if let flushedAt, now.timeIntervalSince(flushedAt) < flushInterval { return }
        flushedAt = now
        Task { @MainActor in
            await UsageIngest.flush(days, platform: platform, arch: arch) { try await UsageIngest.send($0) }
        }
    }

    private static var platform: String { MobileDevice.isPad ? "ipados" : "ios" }

    private static var arch: String {
        #if arch(arm64)
            return "arm64"
        #else
            return "other"
        #endif
    }
}
