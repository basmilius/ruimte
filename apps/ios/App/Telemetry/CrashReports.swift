import Foundation
import RuimteTransport
import Sentry
import Synchronization

/// Crashes, hangs and connection problems of a build that ships, with a session per run, and nothing else: no tracing,
/// no breadcrumbs, no screenshots, no logs. Only the DSN and the start name the service, so the DSN can point at any
/// ingest that takes the same envelopes. `apps/ios/README.md` ("Crash reports") has what goes out.
enum CrashReports {
    // A DSN only lets a client send, so it is no secret.
    private static let dsn =
        "https://48ef3786734e40099009e3cf2bf9ffae@ingest.bmnw.nl/6"
    /// The tags a report may carry; every other one is dropped.
    static let tags: Set<String> = ["surface", "problem", "machine", "link", "request", "mismatch"]
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
            options.maxBreadcrumbs = 0
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            options.attachStacktrace = false
            options.enableLogs = false
            options.enableMetrics = false
            options.enableMetricKit = false
            options.sendClientReports = false
            options.sessionReplay.sessionSampleRate = 0
            options.sessionReplay.onErrorSampleRate = 0
            options.beforeBreadcrumb = { _ in nil }
            options.beforeSend = { event in
                guard scrub(event, with: CrashScrubber(redactions: CrashRedactions.all)) else { return nil }
                return dedupe.admit(event.signature.key) ? event : nil
            }
        }
        SentrySDK.configureScope { scope in scope.setTag(value: "ios", key: "surface") }
        LinkProblems.setReporter { report($0) }
    }

    static func report(_ problem: LinkProblem) {
        let report = ConnectionReport(problem)
        let event = Event(level: .error)
        event.message = SentryMessage(formatted: report.message)
        event.fingerprint = report.fingerprint
        event.tags = report.tags
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
        event.breadcrumbs = nil
        event.extra = nil
        if let message = event.message {
            event.message = SentryMessage(formatted: scrubber.scrubMessage(message.formatted))
        }
        event.fingerprint = event.fingerprint?.map(scrubber.scrubMessage)
        event.tags = event.tags?.filter { tags.contains($0.key) }.mapValues {
            CrashScrubber.truncate(scrubber.scrubText($0), CrashScrubber.maxTag)
        }
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
            exception.type = exception.type.map { CrashScrubber.truncate(scrubber.scrubText($0), CrashScrubber.maxTag) }
            exception.module = nil
            if let mechanism = exception.mechanism {
                mechanism.desc = nil
                mechanism.data = nil
                mechanism.helpLink = nil
            }
            scrub(exception.stacktrace, with: scrubber)
        }
        for thread in event.threads ?? [] {
            thread.name = thread.name.map { CrashScrubber.truncate(scrubber.scrubText($0), CrashScrubber.maxTag) }
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
        case .timeout(let request):
            message = "\(request) got no answer in time"
            fingerprint = ["request-timeout", request]
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
