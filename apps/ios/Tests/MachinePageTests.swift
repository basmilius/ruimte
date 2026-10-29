import Observation
import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class MachinePageTests: XCTestCase {
    private func defaults() -> UserDefaults {
        let domain = "machine-page-tests-\(UUID().uuidString)"
        let store = UserDefaults(suiteName: domain)!
        addTeardownBlock { UserDefaults(suiteName: domain)?.removePersistentDomain(forName: domain) }
        return store
    }

    private func info(_ extra: [String: JSONValue] = [:]) -> JSONValue {
        .object(
            [
                "id": .string("studio"), "label": .string("Studio"), "nameSource": .string("default"),
                "platform": .string("darwin"), "version": .string("0.42.1"), "reachability": .string("lan"),
                "authenticated": .bool(true), "icon": .null, "keepAwake": .string("working"),
                "keepAwakeOnBattery": .bool(false), "keepAwakeDisplay": .bool(false), "keepAwakeAvailable": .bool(true),
                "update": .object([
                    "status": .string("ready"), "version": .string("0.43.0"), "app": .bool(true),
                ]),
            ].merging(extra) { _, new in new })
    }

    @MainActor private func started(_ machine: FakeMachine) async -> MachineEndpoint {
        let endpoint = MachineEndpoint(
            client: machine, machineID: "studio", defaults: defaults(),
            clock: { Date(timeIntervalSince1970: 1_800_000_000) })
        let read = NativeTaskDrain { endpoint.start() }
        await read.finish()
        return endpoint
    }

    @MainActor func testTheMachineIsReadOnConnectAndFollowedThroughItsEvents() async {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info() }
        let endpoint = await started(machine)
        XCTAssertEqual(endpoint.version, "0.42.1")
        XCTAssertEqual(
            endpoint.keepAwake, MachineKeepAwake(mode: .working, onBattery: false, display: false, lidClosed: false))
        XCTAssertEqual(endpoint.update?.action, "Restart")
        XCTAssertEqual(endpoint.update?.headline, "Ruimte 0.43.0 is ready on this machine.")

        machine.emit(
            "endpoint.changed",
            .object([
                "id": .string("studio"), "label": .string("Studio"), "nameSource": .string("chosen"),
                "icon": .object(["kind": .string("lucide"), "value": .string("server")]),
                "keepAwake": .string("always"),
            ]))
        XCTAssertEqual(endpoint.keepAwake?.mode, .always, "An event keeps the availability it never carries")
        XCTAssertEqual(endpoint.icon?.value, "server")
        XCTAssertEqual(endpoint.update?.status, "ready", "An identity event leaves the update alone")

        machine.emit(
            "endpoint.updateChanged",
            .object([
                "update": .object([
                    "status": .string("downloading"), "version": .string("0.43.0"), "percent": .number(42.6),
                    "app": .bool(true),
                ])
            ]))
        XCTAssertEqual(endpoint.update?.headline, "Downloading Ruimte 0.43.0, 42%.")
        XCTAssertEqual(endpoint.update?.action, "Update")
        endpoint.stop()
    }

    @MainActor func testAnUpdateWithoutTheAppIsToldButCannotBeStartedFromThePhone() {
        let update = MachineUpdate(
            .object(["status": .string("available"), "version": .string("0.43.0"), "app": .bool(false)]))
        XCTAssertEqual(update?.installable, true)
        XCTAssertNil(update?.action)
        XCTAssertEqual(update?.note, "Open Ruimte on the machine to install it there.")
        XCTAssertNil(MachineUpdate(.object(["status": .string("unsupported"), "app": .bool(false)]))?.headline)
        XCTAssertNil(
            MachineUpdate(.object(["status": .string("something-newer"), "app": .bool(true)]))?.action,
            "A step this phone does not know is nothing to act on")
    }

    @MainActor func testKeepAwakeIsHiddenWhereTheMachineCannotHoldIt() async {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info(["keepAwakeAvailable": .bool(false)]) }
        let endpoint = await started(machine)
        XCTAssertNil(endpoint.keepAwake)
        XCTAssertNil(
            MachineEndpoint.keepAwake(in: info(["keepAwake": .null])), "Without a mode there is nothing to show")
        endpoint.stop()
    }

    @MainActor func testKeepAwakeIsWrittenWithTheNameOnlyWhenAPersonChoseIt() async throws {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info() }
        machine.answers["endpoint.setIdentity"] = { payload in
            self.info([
                "keepAwake": payload["keepAwake"] ?? .null,
                "keepAwakeOnBattery": payload["keepAwakeOnBattery"] ?? .null,
            ])
        }
        let endpoint = await started(machine)
        await endpoint.setKeepAwake(MachineKeepAwake(mode: .always, onBattery: true, display: false, lidClosed: false))
        let sent = try XCTUnwrap(machine.sent.last { $0.0 == "endpoint.setIdentity" }?.1)
        XCTAssertEqual(sent["name"], .null, "A default name sent back would become a chosen one")
        XCTAssertEqual(sent["icon"], .null)
        XCTAssertEqual(sent["keepAwake"], .string("always"))
        XCTAssertEqual(sent["keepAwakeOnBattery"], .bool(true))
        XCTAssertEqual(
            endpoint.keepAwake, MachineKeepAwake(mode: .always, onBattery: true, display: false, lidClosed: false))
        XCTAssertTrue(endpoint.keepAwake?.displayApplies == true)

        machine.refusals["endpoint.setIdentity"] = "forbidden"
        await endpoint.setKeepAwake(MachineKeepAwake(mode: .off, onBattery: true, display: false, lidClosed: false))
        XCTAssertEqual(endpoint.keepAwake?.mode, .always, "A refused write puts the switch back")
        XCTAssertNotNil(endpoint.problem)
        endpoint.stop()
    }

    @MainActor func testTheClosedLidIsUsableOnlyOnceTheRuleIsOnTheMacAndFollowsItsEvents() async throws {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in
            self.info([
                "keepAwakeLidAvailable": .bool(true), "keepAwakeLidRule": .bool(false),
                "keepAwakeLidClosed": .bool(false),
            ])
        }
        machine.answers["endpoint.setIdentity"] = { payload in
            self.info([
                "keepAwakeLidAvailable": .bool(true), "keepAwakeLidRule": .bool(true),
                "keepAwakeLidClosed": payload["keepAwakeLidClosed"] ?? .null,
            ])
        }
        let endpoint = await started(machine)
        XCTAssertEqual(endpoint.closedLid, MachineClosedLid(ruleInstalled: false))

        machine.emit("endpoint.changed", .object(["keepAwakeLidRule": .bool(true)]))
        XCTAssertEqual(
            endpoint.closedLid, MachineClosedLid(ruleInstalled: true), "Installing on the Mac reaches the phone")

        await endpoint.setKeepAwake(MachineKeepAwake(mode: .working, onBattery: false, display: false, lidClosed: true))
        let sent = try XCTUnwrap(machine.sent.last { $0.0 == "endpoint.setIdentity" }?.1)
        XCTAssertEqual(sent["keepAwakeLidClosed"], .bool(true))
        XCTAssertEqual(endpoint.keepAwake?.lidClosed, true)
        endpoint.stop()
    }

    @MainActor func testAMachineWithoutTheClosedLidIsNeverToldAboutIt() async throws {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info() }
        machine.answers["endpoint.setIdentity"] = { _ in self.info(["keepAwake": .string("always")]) }
        let endpoint = await started(machine)
        XCTAssertNil(endpoint.closedLid)
        await endpoint.setKeepAwake(MachineKeepAwake(mode: .always, onBattery: false, display: false, lidClosed: false))
        let sent = try XCTUnwrap(machine.sent.last { $0.0 == "endpoint.setIdentity" }?.1)
        XCTAssertNil(sent["keepAwakeLidClosed"])
        endpoint.stop()
    }

    @MainActor func testTheDoorOnTheLocalNetworkIsLearnedFromEveryAnswerAndForgottenOnceClosed() async {
        let machine = FakeMachine()
        let lan: JSONValue = .object(["port": .number(4220), "addresses": .array([.string("192.168.1.20")])])
        machine.answers["endpoint.info"] = { _ in self.info(["lan": lan, "lanDoor": .bool(true)]) }
        var learned: [LanDoorAddress?] = []
        let endpoint = MachineEndpoint(
            client: machine, machineID: "studio", defaults: defaults(),
            clock: { Date(timeIntervalSince1970: 1_800_000_000) }, learnedLan: { learned.append($0) })
        let read = NativeTaskDrain { endpoint.start() }
        await read.finish()
        XCTAssertEqual(learned, [LanDoorAddress(port: 4220, addresses: ["192.168.1.20"])])
        machine.emit("endpoint.changed", .object(["id": .string("studio"), "label": .string("Studio")]))
        XCTAssertEqual(
            learned.last, LanDoorAddress(port: 4220, addresses: ["192.168.1.20"]),
            "An event that leaves it out changes nothing")
        machine.emit("endpoint.changed", .object(["lan": .null, "lanDoor": .bool(false)]))
        XCTAssertEqual(learned.last, .some(nil))
        XCTAssertEqual(endpoint.lanDoor, false)
        endpoint.stop()
    }

    @MainActor func testAnAnswerWithoutTheDoorSwitchReadsItOpen() async {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info() }
        let endpoint = await started(machine)
        XCTAssertEqual(endpoint.lanDoor, true)
        endpoint.stop()
    }

    @MainActor func testTheDoorSwitchGoesThroughSetIdentityAndStandsBackWhenRefused() async throws {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info(["lanDoor": .bool(true), "lanDoorFixed": .bool(false)]) }
        machine.answers["endpoint.setIdentity"] = { payload in
            self.info(["lanDoor": payload["lanDoor"] ?? .null, "lan": .null])
        }
        let endpoint = await started(machine)
        XCTAssertEqual(endpoint.lanDoor, true)
        XCTAssertFalse(endpoint.lanDoorFixed)
        await endpoint.setLanDoor(false)
        let sent = try XCTUnwrap(machine.sent.last { $0.0 == "endpoint.setIdentity" }?.1)
        XCTAssertEqual(sent["lanDoor"], .bool(false))
        XCTAssertEqual(sent["name"], .null)
        XCTAssertEqual(endpoint.lanDoor, false)

        machine.refusals["endpoint.setIdentity"] = "forbidden"
        await endpoint.setLanDoor(true)
        XCTAssertEqual(endpoint.lanDoor, false, "A refused write puts the switch back")
        XCTAssertNotNil(endpoint.problem)
        XCTAssertNil(
            MachineEndpoint(client: machine, machineID: "studio", defaults: defaults()).lanDoor,
            "Nothing read, nothing to show")
        endpoint.stop()
    }

    @MainActor func testRenamingSendsTheNameAndIconTogetherAndAnEmptyNameAsNull() async throws {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info() }
        machine.answers["endpoint.setIdentity"] = { payload in
            self.info([
                "label": payload["name"] ?? .null, "nameSource": .string("chosen"), "icon": payload["icon"] ?? .null,
            ])
        }
        let endpoint = await started(machine)
        try await endpoint.setIdentity(name: "  Studio  ", icon: MachineIcon(value: "laptop"))
        XCTAssertEqual(machine.sent.last?.1["name"], .string("Studio"))
        XCTAssertEqual(machine.sent.last?.1["icon"]?["value"], .string("laptop"))
        try await endpoint.setIdentity(name: " ", icon: nil)
        XCTAssertEqual(machine.sent.last?.1["name"], .null)
        XCTAssertEqual(machine.sent.last?.1["icon"], .null)
        endpoint.stop()
    }

    @MainActor func testAnInstallFirstSaysWhatEndsAndOnlyASecondAskInstalls() async {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info() }
        machine.answers["endpoint.installUpdate"] = { payload in
            .object([
                "started": .bool(payload["confirm"] == .bool(true)),
                "ending": .object(["terminals": .number(2), "agents": .number(1)]),
            ])
        }
        let endpoint = await started(machine)
        await endpoint.askToInstall()
        XCTAssertEqual(machine.sent.last?.1["confirm"], .bool(false))
        XCTAssertEqual(endpoint.install, .confirming(MachineWork(terminals: 2, agents: 1)))
        XCTAssertEqual(
            MachineUpdate.restartQuestion(
                update: endpoint.update, work: MachineWork(terminals: 2, agents: 1), machine: "Studio"),
            "Ruimte 0.43.0 installs and Ruimte restarts on Studio. That ends 2 terminals and 1 agent running there now."
        )
        XCTAssertEqual(
            MachineUpdate.restartQuestion(update: nil, work: MachineWork(terminals: 0, agents: 0), machine: "Studio"),
            "The update downloads, installs and Ruimte restarts on Studio. Nothing that runs there ends.")

        await endpoint.confirmInstall()
        XCTAssertEqual(machine.sent.last?.1["confirm"], .bool(true))
        XCTAssertEqual(endpoint.install, .started)

        machine.setConnected(false)
        let reconnected = NativeTaskDrain { machine.setConnected(true) }
        await reconnected.finish()
        XCTAssertEqual(endpoint.install, .idle, "The machine that comes back after the restart starts over")
        endpoint.stop()
    }

    @MainActor func testACancelledOrRefusedInstallGoesBackToIdleAndSaysWhy() async {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info() }
        machine.answers["endpoint.installUpdate"] = { _ in
            .object(["started": .bool(false), "ending": .object(["terminals": .number(0), "agents": .number(0)])])
        }
        let endpoint = await started(machine)
        await endpoint.confirmInstall()
        XCTAssertTrue(machine.sent.allSatisfy { $0.0 != "endpoint.installUpdate" }, "Nothing installs unasked")

        await endpoint.askToInstall()
        endpoint.cancelInstall()
        XCTAssertEqual(endpoint.install, .idle)

        await endpoint.askToInstall()
        machine.refusals["endpoint.installUpdate"] = "update-no-app"
        await endpoint.confirmInstall()
        XCTAssertEqual(endpoint.install, .idle)
        XCTAssertEqual(endpoint.problem, "Ruimte is not open on this machine. Install the update there.")
        machine.refusals["endpoint.installUpdate"] = "update-none"
        await endpoint.askToInstall()
        XCTAssertEqual(endpoint.problem, "There is no update to install on this machine.")
        endpoint.stop()
    }

    @MainActor func testTheLastConnectionIsRememberedAndTheReachSaysHowAndHowFast() async {
        let store = defaults()
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info() }
        let moment = Date(timeIntervalSince1970: 1_800_000_000)
        let endpoint = MachineEndpoint(client: machine, machineID: "studio", defaults: store, clock: { moment })
        endpoint.start()
        machine.setConnected(false)
        endpoint.stop()
        XCTAssertEqual(MachineEndpoint(client: machine, machineID: "studio", defaults: store).lastConnected, moment)

        XCTAssertEqual(
            MachineReach.line(
                connected: true, connecting: false, route: .relayed, latency: 38, problem: nil, lastSeen: nil),
            "Relayed · 38 ms")
        XCTAssertEqual(
            MachineReach.line(
                connected: true, connecting: false, route: .localNetwork, latency: nil, problem: nil, lastSeen: nil),
            "Local network")
        XCTAssertEqual(
            MachineReach.line(
                connected: true, connecting: false, route: .broker, latency: 12, problem: nil, lastSeen: nil),
            "Through your account · 12 ms")
        XCTAssertEqual(
            MachineReach.line(
                connected: true, connecting: false, route: nil, latency: nil, problem: nil, lastSeen: nil),
            "Connected")
        XCTAssertEqual(
            MachineReach.line(
                connected: false, connecting: true, route: nil, latency: nil, problem: nil, lastSeen: moment),
            "Connecting")
        XCTAssertEqual(
            MachineReach.line(
                connected: false, connecting: false, route: nil, latency: nil, problem: "Refused", lastSeen: nil),
            "Refused")
        XCTAssertTrue(
            MachineReach.line(
                connected: false, connecting: false, route: nil, latency: nil, problem: nil, lastSeen: moment
            ).hasPrefix("Last connected"))
    }

    @MainActor func testAPingIsTimedOnlyWhileConnected() async {
        let machine = FakeMachine()
        machine.answers["endpoint.info"] = { _ in self.info() }
        machine.answers["server.ping"] = { _ in .object(["time": .number(0)]) }
        let endpoint = await started(machine)
        await endpoint.measureLatency()
        XCTAssertNotNil(endpoint.latency)
        let pings = machine.sent.filter { $0.0 == "server.ping" }.count
        XCTAssertEqual(pings, 1)
        machine.setConnected(false)
        XCTAssertNil(endpoint.latency)
        await endpoint.measureLatency()
        XCTAssertNil(endpoint.latency)
        XCTAssertEqual(machine.sent.filter { $0.0 == "server.ping" }.count, pings)
        endpoint.stop()
    }

    private func window(_ kind: String, _ label: String, _ used: Double, resetsAt: Double? = nil) -> JSONValue {
        .object([
            "id": .string(label.lowercased()), "kind": .string(kind), "label": .string(label), "used": .number(used),
            "resetsAt": resetsAt.map(JSONValue.number) ?? .null, "durationMs": .null,
        ])
    }

    private func reading(
        _ kind: String, account: String? = nil, label: String? = nil, windows: [JSONValue] = [], checkedAt: Double = 1,
        unavailable: String? = nil
    ) -> JSONValue {
        var value: [String: JSONValue] = [
            "kind": .string(kind), "plan": .null, "checkedAt": .number(checkedAt), "source": .string("probe"),
            "windows": .array(windows), "cost": .null,
            "unavailable": unavailable.map { .object(["reason": .string($0), "message": .null]) } ?? .null,
        ]
        if let account {
            value["account"] = .object([
                "id": .string(account), "label": label.map(JSONValue.string) ?? .string(account),
            ])
        }
        return .object(value)
    }

    private func limits(_ readings: [JSONValue]) -> JSONValue { .object(["providers": .array(readings)]) }

    /// An `accounts.list` answer: every account with its kind, label, whether it is on and its state.
    private func accountList(_ accounts: [(id: String, kind: String, label: String?, enabled: Bool, state: String)])
        -> JSONValue
    {
        .object([
            "accounts": .object(
                Dictionary(
                    uniqueKeysWithValues: accounts.map { account in
                        var value: [String: JSONValue] = [
                            "kind": .string(account.kind), "enabled": .bool(account.enabled),
                        ]
                        if let label = account.label { value["label"] = .string(label) }
                        return (account.id, JSONValue.object(value))
                    })),
            "statuses": .array(
                accounts.map { .object(["id": .string($0.id), "state": .string($0.state)]) }),
        ])
    }

    private func loaded(_ value: JSONValue) -> UsageAccounts { .loaded(ProviderAccountList(value)) }

    @MainActor func testEveryAccountOfACLIGetsARowWithBothWindowsInTheOrderOfItsAccounts() {
        let card = MachineLimits.of(
            limits: limits([
                reading(
                    "claude",
                    windows: [
                        window("weekly", "Weekly", 0.71), window("session", "Session", 0.12),
                        window("weekly", "Weekly · Opus", 1),
                    ]),
                reading("claude", account: "work", label: "Work", windows: [window("session", "Session", 0.88)]),
                reading("codex", windows: [window("weekly", "Weekly", 0.17)]),
            ]),
            accounts: loaded(
                accountList([
                    ("claude", "claude", nil, true, "ready"), ("personal", "claude", "Personal", true, "ready"),
                    ("work", "claude", "Work", true, "ready"), ("codex", "codex", nil, true, "ready"),
                ])))
        XCTAssertEqual(card.lines.map(\.id), ["claude:claude", "claude:personal", "claude:work", "codex:codex"])
        XCTAssertEqual(card.lines.map(\.name), ["Claude", "Personal", "Work", "Codex"])
        XCTAssertEqual(card.lines.map(\.named), [true, true, true, false])
        XCTAssertEqual(
            card.lines.map(\.content),
            [
                .bars(session: .init(label: "Session", used: 0.12), week: .init(label: "Weekly", used: 0.71)),
                .status("Not read yet"),
                .bars(session: .init(label: "Session", used: 0.88), week: nil),
                .bars(session: nil, week: .init(label: "Weekly", used: 0.17)),
            ])
        XCTAssertFalse(card.accountsUnavailable)
    }

    @MainActor func testOneAccountOfACLIShowsItsOwnLabelOrElseTheCLIsName() {
        let card = MachineLimits.of(
            limits: limits([
                reading(
                    "claude", account: "personal", label: "Personal", windows: [window("session", "Session", 0.01)]),
                reading("codex", windows: [window("session", "Session", 0.05)]),
            ]),
            accounts: .unknown)
        XCTAssertEqual(card.lines.map(\.name), ["Personal", "Codex"])
        XCTAssertEqual(card.lines.map(\.named), [false, false])
    }

    @MainActor func testEveryAccountGetsARowHoweverManyThereAre() {
        let ids = ["claude", "a", "b", "c", "d"]
        let card = MachineLimits.of(
            limits: limits(
                ids.map { id in
                    reading("claude", account: id == "claude" ? nil : id, windows: [window("session", "Session", 0.4)])
                }),
            accounts: .unknown)
        XCTAssertEqual(card.lines.map(\.accountID), ids)
    }

    @MainActor func testAWindowPastItsResetReadsAsUnused() {
        let now = Date(timeIntervalSince1970: 1_000)
        let card = MachineLimits.of(
            limits: limits([
                reading(
                    "claude",
                    windows: [
                        window("session", "Session", 0.9, resetsAt: 500_000),
                        window("weekly", "Weekly", 0.5, resetsAt: 2_000_000),
                    ])
            ]),
            accounts: .unknown, now: now)
        XCTAssertEqual(
            card.lines.first?.content,
            .bars(session: .init(label: "Session", used: 0), week: .init(label: "Weekly", used: 0.5)))
    }

    @MainActor func testWhichAccountsShowIsDecidedBeforeTheirStateStandsInForOldNumbers() {
        let card = MachineLimits.of(
            limits: limits([
                reading("claude", windows: [window("session", "Session", 0.3)]),
                reading("claude", account: "old", label: "Old", windows: [window("session", "Session", 0.6)]),
                reading("claude", account: "off", label: "Off", windows: [window("session", "Session", 0.6)]),
                reading("claude", account: "broken", label: "Broken", unavailable: "failed"),
                reading("codex", unavailable: "no-subscription"),
                reading("gemini", unavailable: "not-installed"),
            ]),
            accounts: loaded(
                accountList([
                    ("claude", "claude", nil, true, "ready"), ("old", "claude", "Old", true, "signed-out"),
                    ("off", "claude", "Off", false, "ready"), ("broken", "claude", "Broken", true, "ready"),
                    ("gone", "claude", "Gone", true, "not-found"), ("codex", "codex", nil, true, "ready"),
                ])))
        XCTAssertEqual(card.lines.map(\.accountID), ["claude", "broken", "old"])
        XCTAssertEqual(card.lines.dropFirst().map(\.content), [.status("Unavailable"), .status("Not logged in")])
    }

    @MainActor func testTheAccountListDecidesWhichAccountsThereAre() {
        let card = MachineLimits.of(
            limits: limits([
                reading("claude", windows: [window("session", "Session", 0.3)]),
                reading("claude", account: "removed", label: "Removed", windows: [window("session", "Session", 0.6)]),
            ]),
            accounts: loaded(
                accountList([("claude", "claude", nil, true, "ready"), ("codex", "codex", nil, true, "ready")])))
        XCTAssertEqual(card.lines.map(\.id), ["claude:claude", "codex:codex"])
        XCTAssertEqual(card.lines.last?.content, .status("Not read yet"))
    }

    @MainActor func testAnAccountListThatFailedKeepsTheNumbersAndSaysSo() {
        let reading = limits([reading("claude", windows: [window("session", "Session", 0.3)])])
        let failed = MachineLimits.of(limits: reading, accounts: .failed)
        XCTAssertEqual(failed.lines.map(\.id), ["claude:claude"])
        XCTAssertTrue(failed.accountsUnavailable)
        XCTAssertFalse(MachineLimits.of(limits: reading, accounts: loaded(accountList([]))).accountsUnavailable)
    }

    @MainActor func testTwoAccountsOfOneNameAreToldApartByTheirID() {
        let card = MachineLimits.of(
            limits: limits([
                reading("claude", account: "work", label: "Work", windows: [window("session", "Session", 0.1)]),
                reading("claude", account: "work-2", label: "Work", windows: [window("session", "Session", 0.2)]),
            ]),
            accounts: .unknown)
        XCTAssertEqual(card.lines.map(\.name), ["Work (work)", "Work (work-2)"])
    }

    @MainActor func testBeforeAReadingTheSnapshotShowsItsAccountsAsTheListHasThem() {
        let providers = [
            UsageWidgetSnapshot.Provider(
                kind: "claude", windows: [.init(kind: "session", label: "Session", used: 0.62, resetsAt: nil)]),
            UsageWidgetSnapshot.Provider(
                kind: "claude", account: .init(id: "work", label: "Work"),
                windows: [.init(kind: "weekly", label: "Weekly", used: 0.9, resetsAt: nil)]),
            UsageWidgetSnapshot.Provider(
                kind: "claude", account: .init(id: "off", label: "Off"),
                windows: [.init(kind: "weekly", label: "Weekly", used: 0.9, resetsAt: nil)]),
        ]
        let unlisted = MachineLimits.of(providers: providers, accounts: .unknown)
        XCTAssertEqual(unlisted.lines.map(\.accountID), ["claude", "work", "off"])
        let listed = MachineLimits.of(
            providers: providers,
            accounts: loaded(
                accountList([
                    ("claude", "claude", nil, true, "ready"), ("work", "claude", "Work", true, "ready"),
                    ("off", "claude", "Off", false, "ready"), ("new", "claude", "New", true, "ready"),
                ])))
        XCTAssertEqual(listed.lines.map(\.accountID), ["claude", "new", "work"])
        XCTAssertEqual(listed.lines[1].content, .status("Not read yet"))
    }

    @MainActor func testTheRecorderListsTheAccountsOncePerConnectionAndFollowsThem() async {
        let machine = FakeMachine()
        machine.answers["usage.limits"] = { _ in self.limits([]) }
        machine.answers["accounts.list"] = { _ in self.accountList([("claude", "claude", nil, true, "ready")]) }
        let recorder = UsageWidgetRecorder(machineID: "recorder-\(UUID().uuidString)", client: machine)
        let initial = NativeTaskDrain { recorder.start() }
        await initial.finish()
        XCTAssertEqual(recorder.accounts, loaded(accountList([("claude", "claude", nil, true, "ready")])))
        let changedLimits = NativeTaskDrain {
            machine.emit(
                "usage.limitsChanged", limits([reading("claude", windows: [window("session", "Session", 0.4)])]))
        }
        let changed = accountList([("claude", "claude", nil, true, "ready"), ("work", "claude", "Work", true, "ready")])
        machine.emit("accounts.changed", changed)
        await changedLimits.finish()
        XCTAssertEqual(recorder.accounts, loaded(changed))
        XCTAssertEqual(machine.sent.filter { $0.0 == "accounts.list" }.count, 1)
        machine.setConnected(false)
        let reconnected = NativeTaskDrain { machine.setConnected(true) }
        await reconnected.finish()
        XCTAssertEqual(machine.sent.filter { $0.0 == "accounts.list" }.count, 2)
        XCTAssertEqual(recorder.accounts, loaded(accountList([("claude", "claude", nil, true, "ready")])))
        recorder.stop()
        XCTAssertNil(recorder.limits)
        XCTAssertEqual(recorder.accounts, .unknown)
    }

    @MainActor func testAnAccountListTheMachineCouldNotGiveIsNotAnEmptyOne() async {
        let machine = FakeMachine()
        machine.refusals["accounts.list"] = "failed"
        let recorder = UsageWidgetRecorder(machineID: "recorder-\(UUID().uuidString)", client: machine)
        let initial = NativeTaskDrain { recorder.start() }
        await initial.finish()
        XCTAssertEqual(recorder.accounts, .failed)
        recorder.stop()
    }

    @MainActor func testLimitsThatChangeWhileALoadWaitsAreNotLostOrOverwritten() async {
        let machine = FakeMachine()
        let old = limits([reading("claude", windows: [window("session", "Session", 0.1)])])
        let newer = limits([reading("claude", windows: [window("session", "Session", 0.7)])])
        machine.answers["usage.limits"] = { _ in old }
        machine.hold("usage.limits")
        let recorder = UsageWidgetRecorder(machineID: "recorder-\(UUID().uuidString)", client: machine)
        let initial = NativeTaskDrain { recorder.start() }
        await machine.waitForRequest("usage.limits")
        machine.emit("usage.limitsChanged", newer)
        XCTAssertEqual(recorder.limits, newer)
        var applied: [JSONValue?] = []
        let observation = withContinuousObservation(options: .didSet) { event in
            let value = recorder.limits
            if event.kind == .didSet { applied.append(value) }
        }
        machine.release("usage.limits")
        await initial.finish()
        withExtendedLifetime(observation) {
            XCTAssertFalse(applied.contains(old), "A stale answer must never replace the event, even briefly")
        }
        XCTAssertEqual(recorder.limits, newer)
        XCTAssertEqual(recorder.providers.first?.windows.first?.used, 0.7)
        recorder.stop()
    }

    private func device(
        _ id: String, platform: String = "ios", kind: String = "simulator", state: String = "shutdown",
        reason: String? = nil, name: String? = nil
    ) -> JSONValue {
        var value: [String: JSONValue] = [
            "deviceId": .string(id), "backendId": .string(platform == "ios" ? "simctl" : "adb"),
            "platform": .string(platform), "kind": .string(kind), "name": .string(name ?? id),
            "runtime": .string(platform == "ios" ? "iOS 26.1" : "Android 16"), "state": .string(state),
            "capabilities": .object([
                "boot": .bool(kind == "simulator"), "shutdown": .bool(kind == "simulator"), "stream": .bool(true),
                "input": .bool(true), "screenshot": .bool(true),
            ]),
        ]
        if let reason { value["reason"] = .string(reason) }
        return .object(value)
    }

    @MainActor func testDevicesAreGroupedAsTheDesktopGroupsThemWithWhatRunsFirst() async {
        let machine = FakeMachine()
        machine.answers["device.list"] = { _ in
            .object([
                "devices": .array([
                    self.device("ipad"), self.device("pixel", platform: "android"),
                    self.device("iphone", state: "booted"),
                    self.device(
                        "phone", platform: "android", kind: "physical", state: "booted", reason: "unauthorized"),
                ]),
                "unavailable": .array([]),
            ])
        }
        let devices = MachineDevices(client: machine)
        await devices.load()
        XCTAssertEqual(
            devices.groups.map(\.title),
            ["Running iOS simulators", "iOS simulators", "Android emulators", "Android devices"])
        XCTAssertEqual(devices.runningCount, 2)
        let phone = devices.devices.first { $0.deviceID == "phone" }
        XCTAssertEqual(phone?.stateText, "Allow USB debugging on the device")
        XCTAssertEqual(phone?.waitsOnPerson, true)
        XCTAssertEqual(devices.devices.first { $0.deviceID == "iphone" }?.displayRuntime, "26.1")
        XCTAssertEqual(devices.devices.first { $0.deviceID == "iphone" }?.stateText, "Running")
    }

    @MainActor func testStreamingTurnedOffClosesTheListAndSaysSo() async {
        let machine = FakeMachine()
        machine.refusals["device.list"] = "streaming-disabled"
        let devices = MachineDevices(client: machine)
        await devices.load()
        XCTAssertTrue(devices.streamingOff)
        XCTAssertNil(devices.problem)
        XCTAssertTrue(devices.loaded)
    }

    @MainActor func testStartingADeviceSendsItsTargetAndTakesTheAnswer() async {
        let machine = FakeMachine()
        machine.answers["device.list"] = { _ in .object(["devices": .array([self.device("ipad")])]) }
        machine.answers["device.boot"] = { _ in self.device("ipad", state: "booted") }
        let devices = MachineDevices(client: machine)
        await devices.load()
        let ipad = devices.devices[0]
        await devices.boot(ipad)
        XCTAssertEqual(machine.sent.last?.0, "device.boot")
        XCTAssertEqual(machine.sent.last?.1, ipad.target)
        XCTAssertEqual(devices.devices[0].state, "booted")
        XCTAssertTrue(devices.changing.isEmpty)

        machine.refusals["device.shutdown"] = "device-busy"
        await devices.shutdown(devices.devices[0])
        XCTAssertEqual(devices.problem?.hasPrefix("Could not shut down ipad."), true)
    }

    @MainActor func testTheNotesSayWhatTheMachineCannotLookFor() {
        let unavailable: [JSONValue] = [
            .object(["platform": .string("ios"), "code": .string("simctl-unavailable"), "message": .string("")]),
            .object(["platform": .string("ios"), "code": .string("devicectl-unavailable"), "message": .string("")]),
            .object(["platform": .string("android"), "code": .string("adb-unavailable"), "message": .string("")]),
        ]
        XCTAssertEqual(
            MachineDevices.notes(unavailable, platform: "darwin"),
            [
                "Install Xcode to use iOS simulators and iPhones.",
                "Install the Android SDK to use Android emulators and devices.",
            ])
        XCTAssertEqual(
            MachineDevices.notes(unavailable, platform: "linux"),
            [
                "Install the Android SDK to use Android emulators and devices.",
                "iOS simulators need a Mac.",
            ])
    }

    func testADeviceOpensTheViewThatAlreadyShowsItOrANewOne() throws {
        let device = try XCTUnwrap(MachineDevice(self.device("iphone", state: "booted", name: "iPhone 17 Pro")))
        let view = DeviceViews.view(for: device, id: "device-1")
        XCTAssertEqual(view["kind"], .string("device"))
        XCTAssertEqual(view["name"], .string("iPhone 17 Pro"))
        XCTAssertEqual(view["device"]?["runtime"], .string("iOS 26.1"))
        XCTAssertNil(view["device"]?["deviceId"], "A project file names a device the way a person does")
        let views: [JSONValue] = [
            .object(["id": .string("chat-1"), "kind": .string("chat")]),
            view,
        ]
        XCTAssertEqual(DeviceViews.existing(in: views, device: device), "device-1")
        let other = try XCTUnwrap(MachineDevice(self.device("ipad")))
        XCTAssertNil(DeviceViews.existing(in: views, device: other))
    }

    func testTheUsageReportStacksEveryDayAndSharesTheBreakdown() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Europe/Amsterdam"))
        let totals: (Double) -> JSONValue = { tokens in
            .object([
                "calls": .number(2), "input": .number(tokens), "cacheRead": .number(0), "cacheWrite": .number(0),
                "cacheWrite1h": .number(0), "output": .number(0), "reasoning": .number(0),
            ])
        }
        let summary = JSONValue.object([
            "from": .string("2026-10-01"), "to": .string("2026-10-03"), "resolution": .string("day"),
            "sessions": .number(3),
            "buckets": .array([
                .object([
                    "slot": .string("2026-10-01"), "provider": .string("claude"), "model": .string("claude-sonnet-4-5"),
                    "totals": totals(100), "costUsd": .number(3), "cacheSavingsUsd": .number(1),
                ]),
                .object([
                    "slot": .string("2026-10-03"), "provider": .string("codex"), "model": .string("gpt-5-codex"),
                    "totals": totals(300), "costUsd": .number(1), "cacheSavingsUsd": .number(0),
                ]),
            ]),
            "models": .array([
                .object([
                    "provider": .string("claude"), "model": .string("claude-sonnet-4-5"), "totals": totals(100),
                    "costUsd": .number(3),
                ]),
                .object([
                    "provider": .string("codex"), "model": .string("gpt-5-codex"), "totals": totals(300),
                    "costUsd": .null,
                ]),
            ]),
            "projects": .array([]),
        ])
        let report = UsageReport(summary, calendar: calendar)
        XCTAssertEqual(report.slots.map(\.id), ["2026-10-01", "2026-10-02", "2026-10-03"])
        XCTAssertEqual(report.slots[1].value(.dollar), 0, "A quiet day keeps its place")
        XCTAssertEqual(report.total.costUsd, 4)
        XCTAssertEqual(report.total.tokens.total, 400)
        XCTAssertEqual(report.cacheSavingsUsd, 1)
        XCTAssertEqual(report.providers.map(\.provider), ["claude", "codex"])
        XCTAssertTrue(report.unpriced)
        let models = report.rows(.models, metric: .tokens)
        XCTAssertEqual(models.first?.provider, "codex")
        XCTAssertEqual(report.share(models[0], metric: .tokens), 0.75)
        XCTAssertNil(report.share(models[0], metric: .dollar), "A model without a price has no share of a cost")
        XCTAssertEqual(report.rows(.day, metric: .dollar).map(\.id), ["2026-10-03", "2026-10-01"])
        XCTAssertEqual(
            UsagePeriod.today.payload(
                now: try XCTUnwrap(UsageReport.date("2026-10-03", calendar: calendar)), calendar: calendar)[
                    "resolution"], .string("hour"))
    }

    func testProcessesGroupPerProjectWithMachineTasksLast() {
        let group: (String, String?) -> ProcessGroup = { id, project in
            ProcessGroup(
                json: .object([
                    "id": .string(id), "kind": .string("terminal"),
                    "projectId": project.map(JSONValue.string) ?? .null, "processes": .array([]),
                ]))
        }
        let sections = ProcessesText.sections(
            [group("daemon", nil), group("a", "p1"), group("b", "p2"), group("c", "p1")],
            projectNames: ["p1": "Recept Maker"])
        XCTAssertEqual(sections.map(\.title), ["Recept Maker", "Another project", "Machine tasks"])
        XCTAssertEqual(sections[0].groups.map(\.id), ["a", "c"])
    }

}

@MainActor private final class FakeMachine: MachineRequesting {
    var answers: [String: (JSONValue) -> JSONValue] = [:]
    var refusals: [String: String] = [:]
    private var held = Set<String>()
    private var pending: [String: CheckedContinuation<Void, Never>] = [:]
    private var arrivals: [String: NativeArrival] = [:]
    var sent: [(String, JSONValue)] = []
    private var handlers: [String: [UUID: @MainActor @Sendable (JSONValue) -> Void]] = [:]
    private var connections: [UUID: @MainActor @Sendable (Bool) -> Void] = [:]
    private var connected = true

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        if held.contains(type) {
            await withCheckedContinuation {
                pending[type] = $0
                arrival(type).record()
            }
        } else {
            arrival(type).record()
        }
        if let code = refusals[type] { throw MachineClientError.server(code: code, message: code) }
        return answers[type]?(payload) ?? .object([:])
    }

    func hold(_ type: String) { held.insert(type) }
    func release(_ type: String) {
        held.remove(type)
        pending.removeValue(forKey: type)?.resume()
    }
    func waitForRequest(_ type: String) async { await arrival(type).wait() }
    private func arrival(_ type: String) -> NativeArrival {
        if let arrival = arrivals[type] { return arrival }
        let arrival = NativeArrival()
        arrivals[type] = arrival
        return arrival
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        let id = UUID()
        handlers[event, default: [:]][id] = handler
        return { [weak self] in self?.handlers[event]?[id] = nil }
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        let id = UUID()
        connections[id] = handler
        handler(connected)
        return { [weak self] in self?.connections[id] = nil }
    }

    func emit(_ event: String, _ payload: JSONValue) {
        for handler in (handlers[event] ?? [:]).values { handler(payload) }
    }

    func setConnected(_ value: Bool) {
        connected = value
        for handler in connections.values { handler(value) }
    }
}
