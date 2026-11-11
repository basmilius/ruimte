import Foundation
import RuimtePulsar
import RuimteTransport
import Sentry
import Synchronization
import XCTest

@testable import Ruimte

private final class MemoryDedupeStore: CrashDedupeStore {
    private let entries = Mutex<[String: Double]>([:])
    var all: [String: Double] { entries.withLock { $0 } }
    func read() -> [String: Double] { entries.withLock { $0 } }
    func write(_ next: [String: Double]) { entries.withLock { $0 = next } }
}

private final class Clock: Sendable {
    private let value = Mutex<Double>(1_000_000)
    var now: Double { value.withLock { $0 } }
    func advance(_ milliseconds: Double) { value.withLock { $0 += milliseconds } }
}

final class CrashReportsTests: XCTestCase {
    private let home = "/var/mobile/Containers/Data/Application/0A1B2C3D-0000-4000-8000-000000000000"

    // The expected strings are what `createScrubber` in `packages/telemetry` returns for the same input.
    func testTheScrubberMatchesTheSharedOne() {
        let scrubber = CrashScrubber(home: home)
        let cases = [
            ("Failed at \(home)/Documents/x.json", "Failed at <path>"),
            ("token=abcdef123 and Bearer xyz.abc", "token=<redacted> and Bearer <redacted>"),
            (
                "mail bas@example.com from 192.168.1.20 and fe80::1ff:fe23:4567:890a at 08:35:12",
                "mail <email> from <ip> and <ip> at 08:35:12"
            ),
            ("SELECT * FROM users WHERE id = 1", "<sql>"),
            (
                "open https://maps.ruimte.app/tiles/1/2?key=1 and https://evil.example.com/a",
                "open https://maps.ruimte.app/<path> and https://<host>/<path>"
            ),
            ("name \"My Secret Project\" and 'short'", "name \"<text>\" and 'short'"),
            ("id 0123456789abcdef0123456789abcdef01 here", "id <redacted> here"),
            ("HOME_DIR=/Users/bas run", "HOME_DIR=<redacted> run"),
            ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "<redacted>"),
            ("/health is a route but /a/b is a path", "/health is a route but <path> is a path"),
            ("ws://localhost:4210/ws and 127.0.0.1", "ws://localhost:4210/<path> and 127.0.0.1"),
        ]
        for (input, expected) in cases {
            XCTAssertEqual(scrubber.scrubText(input), expected, input)
        }
    }

    func testNamesThePhoneKnowsNeverLeave() {
        let scrubber = CrashScrubber(home: home, redactions: ["Orion", "/Users/bas/Projects/Orion", "abc"])
        XCTAssertEqual(scrubber.scrubText("could not open Orion"), "could not open <redacted>")
        XCTAssertEqual(scrubber.scrubText("in /Users/bas/Projects/Orion now"), "in <redacted> now")
        XCTAssertEqual(scrubber.scrubText("abc stays, too short to replace"), "abc stays, too short to replace")
    }

    func testAMessageKeepsItsFirstLineCut() {
        let scrubber = CrashScrubber(home: home)
        XCTAssertEqual(scrubber.scrubMessage("Fatal error\nwith the output of a process"), "Fatal error")
        XCTAssertEqual(scrubber.scrubMessage(String(repeating: "a ", count: 200)).count, 303)
    }

    func testAFrameKeepsItsFileWithoutThePerson() {
        let scrubber = CrashScrubber(home: home)
        XCTAssertEqual(scrubber.scrubPath("\(home)/Library/x.dylib"), "~/Library/x.dylib")
        XCTAssertEqual(
            scrubber.scrubPath("/private/var/mobile/Containers/Shared/AppGroup/ABCDEF01-2345/x"), "~/x")
        XCTAssertEqual(
            scrubber.scrubPath("/private/var/containers/Bundle/Application/X/Ruimte.app/Ruimte"),
            "/private/var/containers/Bundle/Application/X/Ruimte.app/Ruimte")
    }

    // The same keys as `eventKey` in `packages/telemetry`.
    func testASignatureHashesAsTheSharedKey() {
        XCTAssertEqual(CrashSignature(fingerprint: ["request-timeout", "chat.attach"]).key, "a66c80bd")
        XCTAssertEqual(
            CrashSignature(type: "EXC_BREAKPOINT", value: "Fatal error", appFrames: ["Ruimte:a", "Ruimte:c"]).key,
            "b2c66679")
        XCTAssertEqual(
            CrashSignature(
                fingerprint: ["{{ default }}"], type: "EXC_BREAKPOINT", value: "Fatal error",
                appFrames: ["Ruimte:a", "Ruimte:c"]
            ).key,
            "b2c66679")
    }

    func testTheSameErrorGoesOutOnceADay() {
        let store = MemoryDedupeStore()
        let clock = Clock()
        let dedupe = CrashDedupe(store: store, limit: 2, now: { clock.now })
        XCTAssertTrue(dedupe.admit("one"))
        XCTAssertFalse(dedupe.admit("one"))
        XCTAssertTrue(dedupe.admit("two"))
        clock.advance(24 * 60 * 60 * 1000)
        XCTAssertTrue(dedupe.admit("one"))
        clock.advance(1)
        XCTAssertTrue(dedupe.admit("three"))
        XCTAssertEqual(Set(store.all.keys), ["one", "three"])
        clock.advance(1)
        XCTAssertTrue(dedupe.admit("four"))
        XCTAssertEqual(Set(store.all.keys), ["three", "four"])
    }

    func testAnEventKeepsOnlyWhatTheAllowListNames() {
        let event = Event(level: .fatal)
        event.message = SentryMessage(formatted: "Lost \(home)/Documents/a.json\nsecond line")
        event.user = User(userId: "someone")
        event.serverName = "Bas's iPhone"
        event.extra = ["prompt": "write me a poem"]
        event.tags = ["problem": "connection-dropped", "project": "Orion"]
        event.breadcrumbs = [Breadcrumb(level: .info, category: "ui.click")]
        event.context = [
            "device": ["model": "iPhone17,1", "name": "Bas's iPhone", "free_memory": 1],
            "os": ["name": "iOS", "version": "27.0"],
            "culture": ["timezone": "Europe/Amsterdam"],
        ]
        let exception = Exception(value: "Could not read 'Orion notes'", type: "NSInvalidArgumentException")
        exception.mechanism = Mechanism(type: "nsexception")
        exception.mechanism?.desc = "reason with Orion"
        let frame = Frame()
        frame.package = "\(home)/Ruimte.app/Ruimte"
        frame.function = "ChatView.body"
        frame.contextLine = "let secret = 1"
        frame.vars = ["secret": "1"]
        frame.inApp = true
        exception.stacktrace = SentryStacktrace(frames: [frame], registers: [:])
        event.exceptions = [exception]

        XCTAssertTrue(CrashReports.scrub(event, with: CrashScrubber(home: home, redactions: ["Orion"])))
        XCTAssertEqual(event.message?.formatted, "Lost <path>")
        XCTAssertNil(event.user)
        XCTAssertNil(event.serverName)
        XCTAssertNil(event.extra)
        XCTAssertNil(event.breadcrumbs)
        XCTAssertEqual(event.tags, ["problem": "connection-dropped"])
        XCTAssertEqual(event.context.map { Set($0.keys) }, ["device", "os"])
        XCTAssertEqual(event.context?["device"]?.keys.sorted(), ["model"])
        XCTAssertEqual(exception.value, "Could not read '<text>'")
        XCTAssertNil(exception.mechanism?.desc)
        XCTAssertEqual(frame.package, "~/Ruimte.app/Ruimte")
        XCTAssertNil(frame.contextLine)
        XCTAssertNil(frame.vars)
        XCTAssertEqual(frame.function, "ChatView.body")
    }

    func testOnlyTheFixedBreadcrumbsOfTheAppAndItsLinksStayWithoutTheirData() {
        let event = Event(level: .error)
        let woke = Breadcrumb(level: .info, category: "app")
        woke.message = "active"
        woke.data = ["scene": "Orion"]
        let closing = Breadcrumb(level: .info, category: "link")
        closing.message = "closing-peer"
        let other = Breadcrumb(level: .info, category: "link")
        other.message = "opened Orion"
        event.breadcrumbs = [woke, Breadcrumb(level: .info, category: "ui.click"), closing, other]

        XCTAssertTrue(CrashReports.scrub(event, with: CrashScrubber(home: home)))
        let kept = event.breadcrumbs?.map { "\($0.category) \($0.message ?? "")" }
        XCTAssertEqual(kept, ["app active", "link closing-peer"])
        XCTAssertNil(event.breadcrumbs?.first?.data)
    }

    func testTransactionsAreNotErrorReports() {
        let event = Event(level: .info)
        event.type = "transaction"
        XCTAssertFalse(CrashReports.scrub(event, with: CrashScrubber(home: home)))
    }

    func testANativeCrashIsKnownByItsCrashedThreadAndImageOffsets() {
        let frame = Frame()
        frame.package = "/private/var/containers/Bundle/Application/X/Ruimte.app/Ruimte"
        frame.imageAddress = "0x0000000100000000"
        frame.instructionAddress = "0x0000000100001a2c"
        frame.inApp = true
        let system = Frame()
        system.package = "/usr/lib/system/libsystem_kernel.dylib"
        system.inApp = false
        let crashed = SentryThread(threadId: 0)
        crashed.crashed = true
        crashed.stacktrace = SentryStacktrace(frames: [frame, system], registers: [:])
        let event = Event(level: .fatal)
        event.threads = [SentryThread(threadId: 1), crashed]
        event.exceptions = [Exception(value: "Fatal error", type: "EXC_BREAKPOINT")]
        XCTAssertEqual(
            event.signature,
            CrashSignature(type: "EXC_BREAKPOINT", value: "Fatal error", appFrames: ["Ruimte:+0x1a2c"]))
    }

    func testAConnectionProblemReadsAsTheDesktopsDoes() {
        let timeout = ConnectionReport(.timeout(request: "chat.attach"))
        XCTAssertEqual(timeout.message, "A request to a remote machine got no answer in time")
        XCTAssertEqual(timeout.fingerprint, ["request-timeout", "remote", "direct"])
        XCTAssertEqual(
            timeout.tags,
            ["problem": "request-timeout", "machine": "remote", "link": "direct", "request": "chat.attach"])
        let refused = ConnectionReport(.refused(mismatch: .daemonOlder))
        XCTAssertEqual(refused.fingerprint, ["protocol-refused", "daemon-older"])
        XCTAssertEqual(refused.tags["mismatch"], "daemon-older")
        XCTAssertEqual(ConnectionReport(.dropped).tags["problem"], "connection-dropped")
        for report in [timeout, refused, ConnectionReport(.dropped)] {
            XCTAssertTrue(Set(report.tags.keys).isSubset(of: CrashReports.tags))
        }
    }

    /// The counts are what tell the layers apart, so the scrubber has to leave every one of them in the message.
    func testAMissingPromptCardReportsItsCountsThroughTheScrubber() {
        let gap = ChatPromptGap(
            pending: 2, subjects: 0, answered: 1, activeSet: false, approval: false, sharedModel: true,
            rejectedEvent: false)
        let expected =
            "A chat waited on a person without the card to answer it (pending 2, subjects 0, answered 1, active no, "
            + "kind question, shared yes, rejected event no)"
        XCTAssertEqual(gap.message, expected)
        XCTAssertEqual(CrashScrubber(home: home).scrubMessage(gap.message), expected)
    }

    @MainActor func testTheRuntimeRemembersTheNamesOfItsMachines() {
        let runtime = AppRuntime(defaults: UserDefaults(suiteName: "CrashReportsTests.\(UUID().uuidString)")!)
        runtime.machines = [
            Machine(
                id: "machine", name: "Studio of Someone", icon: nil, publicKey: "key", brokerUrl: nil, lastSeenAt: nil)
        ]
        XCTAssertTrue(CrashRedactions.all.contains("Studio of Someone"))
    }

    func testReportsAreOffOutsideABuildThatShips() {
        XCTAssertFalse(CrashReports.enabled)
        XCTAssertEqual(
            CrashReports.release(["CFBundleShortVersionString": "0.19.0", "CFBundleVersion": "42"]),
            "ruimte-ios@0.19.0+42")
    }
}
