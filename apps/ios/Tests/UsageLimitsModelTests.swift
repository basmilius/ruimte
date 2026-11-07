import RuimtePulsar
import RuimteTransport
import SwiftUI
import XCTest

@testable import Ruimte

@MainActor final class UsageLimitsModelTests: XCTestCase {
    func testOnePendingReadKeepsTheOldValuesOnRefusalAndCanRetry() async {
        let machine = LimitsMachine()
        let model = UsageLimitsModel(client: machine)
        await model.load()
        let before = model.limits
        let entered = expectation(description: "Refresh entered")
        machine.entered = { entered.fulfill() }
        machine.hold = true
        machine.refuse = true
        let pending = Task { await model.refresh() }
        await fulfillment(of: [entered], timeout: 1)
        await model.refresh()
        XCTAssertEqual(machine.refreshes, 1)
        XCTAssertTrue(model.reading)
        machine.release()
        await pending.value
        XCTAssertEqual(model.limits, before)
        XCTAssertEqual(model.problem, "Could not read limits. Try again.")
        XCTAssertFalse(model.reading)
        machine.refuse = false
        await model.refresh()
        XCTAssertEqual(model.limits, machine.snapshot)
        XCTAssertNil(model.problem)
        machine.snapshot = .object([
            "providers": .array([
                .object([
                    "kind": .string("claude"), "account": .object(["id": .string("work"), "label": .string("Work")]),
                    "checkedAt": .number(1_793_340_000_000), "source": .string("probe"),
                    "windows": .array([
                        .object(["id": .string("session"), "label": .string("Session"), "used": .number(0.35)])
                    ]),
                    "unavailable": .object(["reason": .string("failed"), "message": .string("CLI did not answer")]),
                ])
            ])
        ])
        await record("limits-phone", machine: machine, width: 390)
        await record("limits-tablet-dark", machine: machine, width: 768, dark: true)
    }

    private func record(_ name: String, machine: LimitsMachine, width: CGFloat, dark: Bool = false) async {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: width, height: 844)
        let view = NavigationStack { MachineUsagePage(client: machine, machineName: "Studio") }
            .preferredColorScheme(dark ? .dark : .light)
        let host = UIHostingController(rootView: view)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            previous?.makeKey()
        }
        for _ in 0..<10 { await Task.yield() }
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
        func scroll(_ view: UIView) -> UIScrollView? {
            if let view = view as? UIScrollView { return view }
            return view.subviews.lazy.compactMap(scroll).first
        }
        if let scroll = scroll(host.view) {
            scroll.setContentOffset(
                CGPoint(x: 0, y: max(0, scroll.contentSize.height - scroll.bounds.height)), animated: false)
        }
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testRefreshingDuringTheFirstLoadKeepsAccountNamesAndLoginCommands() async {
        let machine = LimitsMachine()
        machine.holdSnapshot = true
        let entered = expectation(description: "Initial snapshot held")
        machine.entered = { entered.fulfill() }
        let model = UsageLimitsModel(client: machine)
        let loading = Task { await model.load() }
        await fulfillment(of: [entered], timeout: 1)
        machine.snapshot = .object(["providers": .array([])])
        await model.refresh()
        machine.release()
        await loading.value
        XCTAssertEqual(model.limits, machine.snapshot)
        XCTAssertEqual(model.accounts?.entries.map(\.id), ["work"])
        XCTAssertEqual(model.loginCommands["claude"], "claude auth login")
    }

    func testASuccessfulSnapshotClearsAnEarlierRefreshError() async {
        let machine = LimitsMachine()
        let model = UsageLimitsModel(client: machine)
        machine.refuse = true
        await model.refresh()
        XCTAssertNotNil(model.problem)
        await model.load()
        XCTAssertNil(model.problem)
    }

    func testAnOldMachinesReplyOrErrorCannotReplaceTheNewMachinesPage() async {
        for refused in [false, true] {
            let old = LimitsMachine()
            let next = LimitsMachine()
            next.snapshot = .object(["providers": .array([])])
            let model = UsageLimitsModel(client: old)
            let entered = expectation(description: "Old machine read entered")
            old.entered = { entered.fulfill() }
            old.hold = true
            old.refuse = refused
            let pending = Task { await model.refresh() }
            await fulfillment(of: [entered], timeout: 1)
            model.use(next)
            await model.load()
            old.release()
            await pending.value
            XCTAssertEqual(model.limits, next.snapshot)
            XCTAssertNil(model.problem)
            XCTAssertFalse(model.reading)
        }
    }

    func testDisconnectedMachinesSendNoRead() async {
        let machine = LimitsMachine()
        let model = UsageLimitsModel(client: machine)
        machine.connection?(false)
        await model.load()
        await model.refresh()
        XCTAssertEqual(machine.requests, [])
        XCTAssertFalse(model.connected)
    }
}

@MainActor private final class LimitsMachine: MachineRequesting {
    var requests: [String] = []
    var refreshes = 0
    var hold = false
    var holdSnapshot = false
    var refuse = false
    var entered: (() -> Void)?
    var connection: (@MainActor @Sendable (Bool) -> Void)?
    private var continuation: CheckedContinuation<Void, Never>?
    var snapshot = JSONValue.object([
        "providers": .array([
            .object([
                "kind": .string("claude"), "checkedAt": .number(1_000), "source": .string("probe"),
                "windows": .array([]), "unavailable": .null,
            ])
        ])
    ])

    func release() {
        continuation?.resume()
        continuation = nil
    }

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append(type)
        let captured = snapshot
        if type == "usage.limits", holdSnapshot {
            holdSnapshot = false
            await withCheckedContinuation { continuation in
                self.continuation = continuation
                entered?()
            }
        }
        if type == "usage.refreshLimits" {
            refreshes += 1
            if hold {
                hold = false
                await withCheckedContinuation { continuation in
                    self.continuation = continuation
                    entered?()
                }
            }
            if refuse { throw MachineClientError.invalid("CLI unavailable") }
        }
        if type == "usage.summary" {
            return .object([
                "from": .string("2026-10-30"), "to": .string("2026-10-30"), "resolution": .string("day"),
                "buckets": .array([]),
            ])
        }
        if type == "accounts.list" {
            return .object([
                "accounts": .object(["work": .object(["kind": .string("claude"), "label": .string("Work")])]),
                "loginCommands": .object(["claude": .string("claude auth login")]),
            ])
        }
        return type == "usage.limits" ? captured : snapshot
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        connection = handler
        handler(true)
        return { [weak self] in self?.connection = nil }
    }
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
