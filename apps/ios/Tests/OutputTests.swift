import Foundation
import RuimtePulsar
import RuimteTransport
import Testing

@testable import Ruimte

@Suite @MainActor struct OutputTests {
    private static let now = Date(timeIntervalSince1970: 1_792_000_000)

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    @Test func theListRunsNewestFirstUnderTodayThisWeekAndEarlier() {
        let today = Self.calendar.startOfDay(for: Self.now)
        let items = [
            item("old", at: today.addingTimeInterval(-10 * 86_400)),
            item("morning", at: today.addingTimeInterval(3_600)),
            item("monday", at: today.addingTimeInterval(-5 * 86_400)),
            item("evening", at: today.addingTimeInterval(7_200)),
            item("edge", at: today.addingTimeInterval(-6 * 86_400)),
            item("before", at: today.addingTimeInterval(-6 * 86_400 - 1)),
        ]
        let groups = OutputGroup.groups(items, now: Self.now, calendar: Self.calendar)
        #expect(groups.map(\.period) == [.today, .week, .earlier])
        #expect(
            groups.map { $0.items.map(\.id) } == [["evening", "morning"], ["monday", "edge"], ["before", "old"]])
    }

    @Test func aKindThisVersionDoesNotKnowDrawsAsAnExport() {
        #expect(OutputKind.drawn("report") == "report")
        #expect(OutputKind.drawn("dataset") == "export")
        #expect(OutputKind.icon("dataset") == OutputKind.icon("export"))
    }

    @Test func theListReadsTheProjectAndReadsAgainWhenOneOfItsItemsChanges() async {
        let machine = OutputMachineFake(items: [Self.summary("a", title: "Morning summary")])
        let store = ProjectOutput(client: machine, projectID: "p1")
        store.start()
        await waitForNativeState { store.items?.count == 1 }
        #expect(machine.requests.first == .artifactWatch)
        #expect(machine.listed == 1)

        machine.items.append(Self.summary("b", title: "E2E report"))
        machine.emit(.object(["artifactId": .string("b"), "projectId": .string("other")]))
        machine.emit(.object(["artifactId": .string("b"), "projectId": .string("p1")]))
        await waitForNativeState { store.items?.count == 2 }
        #expect(machine.listed == 2)
        #expect(store.items?.last?.title == "E2E report")
        #expect(store.items?.first?.versionCount == 3)
        store.stop()
    }

    @Test func aDroppedLinkSaysTheMachineIsNotReachableAndAReconnectWatchesAndReadsAgain() async {
        let machine = OutputMachineFake(items: [Self.summary("a", title: "Morning summary")])
        let store = ProjectOutput(client: machine, projectID: "p1")
        store.start()
        await waitForNativeState { store.items != nil }
        machine.connection(false)
        #expect(!store.reachable)
        machine.connection(true)
        await machine.lists.wait(for: 2)
        #expect(machine.requests.filter { $0 == .artifactWatch }.count == 2)
        await waitForNativeState { store.reachable }
        store.stop()
    }

    @Test func aReadTheLinkDroppedUnderIsNotReachableRatherThanAnError() async {
        let machine = OutputMachineFake(items: [])
        machine.failure = .disconnected
        let store = ProjectOutput(client: machine, projectID: "p1")
        await store.load()
        #expect(!store.reachable)
        #expect(store.problem == nil)
        machine.failure = .server(code: "internal", message: "Broken")
        await store.load()
        #expect(store.problem == "Broken")
        machine.failure = nil
        await store.load()
        #expect(store.reachable)
        #expect(store.items == [])
    }

    @Test func anItemShowsItsLatestVersionUntilAnotherIsPickedAndGoesWhenRemoved() async {
        let machine = OutputMachineFake(items: [])
        let model = OutputItemModel(client: machine, artifactID: "a")
        model.start()
        await waitForNativeState { model.loaded }
        #expect(model.version?.number == 3)
        #expect(model.title == "Morning summary")
        model.selectedID = "v1"
        #expect(model.version?.number == 1)
        model.selectedID = "gone"
        #expect(model.version == nil)

        machine.emit(.object(["artifactId": .string("a"), "projectId": .string("p1"), "removed": .bool(true)]))
        #expect(model.gone)
        model.stop()
    }

    @Test func anItemTheMachineNoLongerKnowsIsGone() async {
        let machine = OutputMachineFake(items: [])
        machine.failure = .server(code: "not-found", message: "Not found")
        let model = OutputItemModel(client: machine, artifactID: "a")
        await model.load()
        #expect(model.gone)
        #expect(model.problem == nil)
    }

    @Test func theMakerIsYouOrTheModelTheAgentRanByItsCatalogName() async {
        let machine = OutputMachineFake(items: [])
        let model = OutputItemModel(client: machine, artifactID: "a")
        await model.load()
        #expect(model.maker(Self.provenance(maker: "person")) == String(localized: "You"))
        #expect(model.maker(Self.provenance(maker: "agent")) == String(localized: "Agent"))
        #expect(model.maker(Self.provenance(maker: "agent", agent: "claude")) == "Claude Code")
        #expect(model.maker(Self.provenance(maker: "agent", agent: "claude", model: "opus")) == "Claude Opus 5.5")
        #expect(model.maker(Self.provenance(maker: "agent", agent: "codex", model: "gpt-5-5")) == "GPT 5.5")
    }

    @Test func aVersionIsLabeledByItsNumberAndMoment() {
        let version = Self.version("v3", number: 3, at: 0).outputVersion
        #expect(version.label.hasPrefix("v3, "))
    }

    @Test func theChatIsNamedAsTheProjectNamesIt() {
        let views: [JSONValue] = [
            .object(["id": .string("chat-1"), "kind": .string("chat"), "name": .string("Release")]),
            .object([
                "id": .string("canvas"), "kind": .string("canvas"),
                "nodes": .array([.object(["id": .string("chat-2"), "kind": .string("chat"), "title": .string("Nightly")])]),
            ]),
        ]
        #expect(OutputContext.chatName(ProjectWire.stored(views), chatID: "chat-1") == "Release")
        #expect(OutputContext.chatName(ProjectWire.stored(views), chatID: "chat-2") == "Nightly")
        #expect(OutputContext.chatName(ProjectWire.stored(views), chatID: "chat-3") == nil)
    }

    private func item(_ id: String, at date: Date) -> OutputItem {
        Self.summary(id, title: id, at: date.timeIntervalSince1970 * 1000).outputItem
    }

    static func provenance(maker: String, agent: String? = nil, model: String? = nil) -> OutputProvenance {
        OutputWire.provenance(maker: maker, agent: agent, model: model).outputProvenance
    }

    static func version(_ id: String, number: Int, at: Double) -> JSONValue {
        OutputWire.version(id, number: number, at: at)
    }

    static func summary(_ id: String, title: String, at: Double = 1_792_000_000_000) -> JSONValue {
        OutputWire.summary(id, title: title, at: at)
    }
}

@MainActor private final class OutputMachineFake: MachineRequesting {
    var items: [JSONValue]
    var failure: MachineClientError?
    private(set) var requests: [WireRequest] = []
    private(set) var listed = 0
    let lists = NativeArrival()
    private var observers: [@MainActor @Sendable (Bool) -> Void] = []
    private var handlers: [WireEvent: [@MainActor @Sendable (JSONValue) -> Void]] = [:]

    init(items: [JSONValue]) { self.items = items }

    func connection(_ connected: Bool) { for observer in observers { observer(connected) } }
    func emit(_ payload: JSONValue) { for handler in handlers[.artifactChanged] ?? [] { handler(payload) } }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        requests.append(type)
        switch type {
        case .artifactList:
            listed += 1
            lists.record()
            if let failure { throw failure }
            return .object(["artifacts": .array(items)])
        case .artifactGet:
            if let failure { throw failure }
            return .object([
                "artifact": .object([
                    "artifactId": .string("a"), "projectId": .string("p1"), "projectName": .string("ruimte"),
                    "title": .string("Morning summary"), "kind": .string("report"), "createdAt": .number(0),
                ]),
                "versions": .array([
                    OutputTests.version("v3", number: 3, at: 3000), OutputTests.version("v2", number: 2, at: 2000),
                    OutputTests.version("v1", number: 1, at: 1000),
                ]),
                "chatPresent": .bool(true),
            ])
        case .providerList:
            return .object([
                "providers": .array([
                    .object([
                        "kind": .string("claude"), "name": .string("Claude Code"),
                        "models": .array([.object(["slug": .string("opus"), "name": .string("Claude Opus 5.5")])]),
                    ]),
                    .object(["kind": .string("codex"), "name": .string("Codex"), "models": .array([])]),
                ])
            ])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        handlers[event, default: []].append(handler)
        return {}
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        observers.append(handler)
        handler(true)
        return {}
    }
}
