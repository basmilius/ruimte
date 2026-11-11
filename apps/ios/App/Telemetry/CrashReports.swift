import Foundation
import RuimteTransport
import Sentry
import Synchronization
import UIKit

/// Crashes, hangs and connection problems of a build that ships, with a session per run and the metrics in
/// `AppMetrics`, and nothing else: no tracing, no breadcrumbs beyond `breadcrumbs`, no screenshots, no logs. Only the DSN and the start name the service, so the DSN can point at any
/// ingest that takes the same envelopes. `apps/ios/README.md` ("Crash reports") has what goes out.
enum CrashReports {
    // A DSN only lets a client send, so it is no secret.
    private static let dsn =
        "https://48ef3786734e40099009e3cf2bf9ffae@ingest.bmnw.nl/6"
    /// The tags a report may carry; every other one is dropped.
    static let tags: Set<String> = ["surface", "problem", "machine", "link", "request", "mismatch"]
    /// The breadcrumbs a report may carry, by category: fixed words for the app's life and its links, never
    /// a screen, a tap or a payload, so a hang says whether it came right after the app woke or a link closed.
    static let breadcrumbs: [String: Set<String>] = [
        "app": ["active", "inactive", "background", "foreground"],
        "link": Set(
            [LinkMoment.connecting, .opened, .closed, .released, .closingPeer].map(\.rawValue)),
    ]
    /// What a report keeps of each context, as `scrub.ts` does.
    static let contexts: [String: Set<String>] = [
        "os": ["name", "version", "build", "kernel_version"],
        "runtime": ["name", "version"],
        "device": ["arch", "family", "model"],
    ]

    /// Off in Debug, in the simulator, in tests and in previews, so only TestFlight and the App Store report.
    static var enabled: Bool {
        #if DEBUG || targetEnvironment(simulator)
            return false
        #else
            let environment = ProcessInfo.processInfo.environment
            return environment["XCTestConfigurationFilePath"] == nil && environment["XCODE_RUNNING_FOR_PREVIEWS"] == nil
        #endif
    }

    static func release(_ info: [String: Any]) -> String {
        let version = info["CFBundleShortVersionString"] as? String ?? "0"
        let build = info["CFBundleVersion"] as? String ?? "0"
        return "ruimte-ios@\(version)+\(build)"
    }

    static func start() {
        guard enabled else { return }
        let dedupe = CrashDedupe(store: DefaultsCrashDedupeStore(defaults: .standard))
        SentrySDK.start { options in
            options.dsn = dsn
            options.releaseName = release(Bundle.main.infoDictionary ?? [:])
            options.environment = "production"
            options.sendDefaultPii = false
            options.enableCrashHandler = true
            options.enableAppHangTracking = true
            options.appHangTimeoutInterval = 2
            options.enableWatchdogTerminationTracking = true
            // The SDK always names the install in a session (`did`); the app's "Count users" switch in Observatory is off, so the ingest drops it.
            options.enableAutoSessionTracking = true
            options.enableAutoPerformanceTracing = false
            options.tracesSampleRate = nil
            options.enableUIViewControllerTracing = false
            options.enableUserInteractionTracing = false
            options.enableNetworkTracking = false
            options.enableNetworkBreadcrumbs = false
            options.enableFileIOTracing = false
            options.enableCoreDataTracing = false
            options.enablePreWarmedAppStartTracing = false
            options.enableCaptureFailedRequests = false
            options.enableSwizzling = false
            options.enableAutoBreadcrumbTracking = false
            options.maxBreadcrumbs = 30
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            options.attachStacktrace = false
            options.enableLogs = false
            options.enableMetrics = true
            options.beforeSendMetric = { metric in
                var kept = metric
                kept.attributes = metric.attributes.filter { AppMetrics.attributes.contains($0.key) }
                return kept
            }
            options.enableMetricKit = false
            options.sendClientReports = false
            options.sessionReplay.sessionSampleRate = 0
            options.sessionReplay.onErrorSampleRate = 0
            options.beforeBreadcrumb = { crumb in allowed(crumb) ? crumb : nil }
            options.beforeSend = { event in
                guard scrub(event, with: CrashScrubber(redactions: CrashRedactions.all)) else { return nil }
                return dedupe.admit(event.signature.key) ? event : nil
            }
        }
        SentrySDK.configureScope { scope in scope.setTag(value: "ios", key: "surface") }
        LinkProblems.setReporter { report($0) }
        LinkProblems.setTrail { note(category: "link", $0.rawValue) }
        LinkMeasures.setMeter { AppMetrics.record(AppMetric($0)) }
        let lifecycle: [(Notification.Name, String)] = [
            (UIApplication.didBecomeActiveNotification, "active"),
            (UIApplication.willResignActiveNotification, "inactive"),
            (UIApplication.didEnterBackgroundNotification, "background"),
            (UIApplication.willEnterForegroundNotification, "foreground"),
        ]
        for (name, moment) in lifecycle {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { _ in
                note(category: "app", moment)
            }
        }
        NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
        ) { _ in AppMetrics.flush() }
    }

    private static func note(category: String, _ message: String) {
        let crumb = Breadcrumb(level: .info, category: category)
        crumb.message = message
        SentrySDK.addBreadcrumb(crumb)
    }

    static func allowed(_ crumb: Breadcrumb) -> Bool {
        guard let message = crumb.message else { return false }
        return breadcrumbs[crumb.category]?.contains(message) == true
    }

    static func report(_ problem: LinkProblem) {
        let report = ConnectionReport(problem)
        let event = Event(level: .error)
        event.message = SentryMessage(formatted: report.message)
        event.fingerprint = report.fingerprint
        event.tags = report.tags
        SentrySDK.capture(event: event)
    }

    static func report(_ gap: ChatPromptGap) {
        let event = Event(level: .error)
        event.message = SentryMessage(formatted: gap.message)
        event.fingerprint = ["prompt-card-missing", gap.child == nil ? "own" : "child"]
        event.tags = ["problem": "prompt-card-missing"]
        SentrySDK.capture(event: event)
    }

    /// Takes out of an event everything the allow-list does not name, and scrubs every string left. False for
    /// anything that is not an error, which carries far more and is never sent.
    static func scrub(_ event: Event, with scrubber: CrashScrubber) -> Bool {
        if event.type != nil {
            return false
        }
        event.error = nil
        event.logger = nil
        event.serverName = nil
        event.transaction = nil
        event.user = nil
        event.request = nil
        event.modules = nil
        let crumbs = (event.breadcrumbs ?? []).filter(allowed)
        for crumb in crumbs {
            crumb.data = nil
            crumb.type = nil
            crumb.origin = nil
        }
        event.breadcrumbs = crumbs.isEmpty ? nil : crumbs
        event.extra = nil
        if let message = event.message {
            event.message = SentryMessage(formatted: scrubber.scrubMessage(message.formatted))
        }
        event.fingerprint = event.fingerprint?.map(scrubber.scrubMessage)
        event.tags = event.tags?.filter { tags.contains($0.key) }.mapValues(scrubber.scrubTag)
        event.context = event.context.map { context in
            context.reduce(into: [:]) { kept, entry in
                guard let fields = contexts[entry.key] else { return }
                kept[entry.key] = entry.value.filter { fields.contains($0.key) }.mapValues { value in
                    (value as? String).map(scrubber.scrubText) ?? value
                }
            }
        }
        if let sdk = event.sdk {
            event.sdk = sdk.filter { $0.key == "name" || $0.key == "version" }
        }
        for exception in event.exceptions ?? [] {
            exception.value = exception.value.map(scrubber.scrubMessage)
            exception.type = exception.type.map(scrubber.scrubTag)
            exception.module = nil
            if let mechanism = exception.mechanism {
                mechanism.desc = nil
                mechanism.data = nil
                mechanism.helpLink = nil
            }
            scrub(exception.stacktrace, with: scrubber)
        }
        for thread in event.threads ?? [] {
            thread.name = thread.name.map(scrubber.scrubTag)
            scrub(thread.stacktrace, with: scrubber)
        }
        scrub(event.stacktrace, with: scrubber)
        for image in event.debugMeta ?? [] {
            image.codeFile = image.codeFile.map(scrubber.scrubPath)
        }
        return true
    }

    private static func scrub(_ stacktrace: SentryStacktrace?, with scrubber: CrashScrubber) {
        for frame in stacktrace?.frames ?? [] {
            frame.fileName = frame.fileName.map(scrubber.scrubPath)
            frame.module = frame.module.map(scrubber.scrubPath)
            frame.package = frame.package.map(scrubber.scrubPath)
            frame.contextLine = nil
            frame.preContext = nil
            frame.postContext = nil
            frame.vars = nil
        }
    }
}

extension Event {
    /// A native crash keeps its frames on the thread that crashed rather than on the exception.
    var signature: CrashSignature {
        let exception = exceptions?.last
        let crashed = threads?.first { $0.crashed?.boolValue == true }
        let frames = exception?.stacktrace?.frames ?? crashed?.stacktrace?.frames ?? stacktrace?.frames ?? []
        return CrashSignature(
            fingerprint: fingerprint ?? [], type: exception?.type ?? "",
            value: exception?.value ?? message?.formatted ?? "",
            appFrames: frames.filter { $0.inApp?.boolValue != false }.map(\.signaturePart))
    }
}

extension Frame {
    /// Where a frame is. A symbol when the device had one, or else the offset into its image, which stays the same
    /// from launch to launch of one build where the address does not.
    fileprivate var signaturePart: String {
        let file = fileName ?? package.map { ($0 as NSString).lastPathComponent } ?? ""
        if let instructionAddress, let imageAddress, let instruction = UInt64(hex: instructionAddress),
            let image = UInt64(hex: imageAddress), instruction >= image
        {
            return "\(file):+0x\(String(instruction - image, radix: 16))"
        }
        return "\(file):\(function ?? "")"
    }
}

extension UInt64 {
    fileprivate init?(hex: String) {
        self.init(hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex, radix: 16)
    }
}

/// A connection problem as a report reads it, the Swift twin of `connectionEvent` in the desktop client. A phone
/// reaches every machine over a direct channel, so `machine` and `link` say that.
struct ConnectionReport: Equatable {
    let message: String
    let fingerprint: [String]
    let tags: [String: String]

    init(_ problem: LinkProblem) {
        let place = ["machine": "remote", "link": "direct"]
        switch problem {
        case .dropped:
            message = "The direct link to a remote machine dropped"
            fingerprint = ["connection-dropped", "remote", "direct"]
            tags = place.merging(["problem": "connection-dropped"]) { $1 }
        // A machine that stops answering leaves every pending request without one, so they group by the link and not the request.
        case .timeout(let request):
            message = "A request to a remote machine got no answer in time"
            fingerprint = ["request-timeout", "remote", "direct"]
            tags = place.merging(["problem": "request-timeout", "request": request]) { $1 }
        case .refused(let mismatch):
            message = "A machine was refused at the protocol check (\(mismatch.rawValue))"
            fingerprint = ["protocol-refused", mismatch.rawValue]
            tags = place.merging(["problem": "protocol-refused", "mismatch": mismatch.rawValue]) { $1 }
        }
    }
}

/// Names this phone knows that never leave in a report: machines, the account, projects and their folders.
enum CrashRedactions {
    private static let limit = 1_000
    private static let values = Mutex<Set<String>>([])

    static var all: [String] { values.withLock { Array($0) } }

    static func remember(_ candidates: some Sequence<String>) {
        values.withLock { values in
            for candidate in candidates where !candidate.isEmpty && values.count < limit {
                values.insert(candidate)
            }
        }
    }
}
