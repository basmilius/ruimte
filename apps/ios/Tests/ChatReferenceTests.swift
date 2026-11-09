import Foundation
import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

/// Holds the iPhone to `Fixtures/view-references.json`, which the desktop's referables test and the daemon's note test
/// read too: the same offer, and the same `chat.send` for the same picks, so the agent gets the same note.
@MainActor final class ChatReferenceTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Item: Decodable {
            let id: String
            let name: String
            let kind: String
            let group: String
            let detail: String?
            let trail: [Step]?
        }

        struct Step: Decodable {
            let id: String
            let name: String
            let kind: String
        }

        struct Pick: Decodable {
            let typed: String
            let id: String
        }

        struct Send: Decodable {
            let text: String
            let chats: [String]
            let references: [String]
        }

        let chatId: String
        let views: [JSONValue]
        let referables: [Item]
        let picks: [Pick]
        let send: Send
    }

    private var root: URL!

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "view-references", withExtension: "json"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testTheOfferIsTheDesktopsGroupsOrderExclusionsAndNames() throws {
        let fixture = try fixture()
        let offered = ChatReferables.project(views: ProjectWire.stored(fixture.views), chatID: fixture.chatId)
        XCTAssertEqual(offered.map(\.id), fixture.referables.map(\.id))
        XCTAssertEqual(offered.map(\.name), fixture.referables.map(\.name))
        XCTAssertEqual(offered.map(\.kind), fixture.referables.map(\.kind))
        XCTAssertEqual(offered.map { $0.group == .canvas ? "canvas" : "views" }, fixture.referables.map(\.group))
        XCTAssertEqual(offered.map(\.detail), fixture.referables.map(\.detail))
        XCTAssertEqual(
            offered.map { $0.trail.map { "\($0.kind) \($0.id) \($0.name)" } },
            fixture.referables.map { ($0.trail ?? []).map { "\($0.kind) \($0.id) \($0.name)" } })
    }

    func testAReferenceWearsTheMarkItsSidebarRowWears() throws {
        let json = """
            [
                {"kind": "canvas", "id": "canvas", "name": "Canvas", "nodes": [
                    {"id": "chat-lead", "kind": "chat", "title": "Lead"},
                    {"id": "node-sketch", "kind": "drawing", "title": "Sketch", "viewId": "drawing-sketch"}
                ]},
                {"kind": "drawing", "id": "drawing-sketch", "name": "Sketch", "icon": {"kind": "lucide", "value": "brain"}},
                {"kind": "chat", "id": "chat-plan", "name": "Plan"}
            ]
            """
        let views = try JSONDecoder().decode([JSONValue].self, from: Data(json.utf8))
        let offered = ChatReferables.project(views: ProjectWire.stored(views), chatID: "chat-lead")
        XCTAssertEqual(offered.map(\.id), ["drawing-sketch", "canvas", "chat-plan"])
        XCTAssertEqual(offered.map(\.mark), ["brain", "frame", "message-square"])
        let lookup = ChatReferenceLookup(items: offered, known: true)
        XCTAssertEqual(ChatReferenceChip.look("drawing-sketch", chat: false, lookup: lookup).icon, "brain")
    }

    func testAMessageOfAnExternalMCPClientWearsAPlugAndIsNotGone() {
        let lookup = ChatReferenceLookup(items: [], known: true)
        let look = ChatReferenceChip.look("external-cred-1", chat: false, lookup: lookup, lastName: "MCP · claude.ai")
        XCTAssertEqual(look.icon, "plug")
        XCTAssertEqual(look.title, "MCP · claude.ai")
        XCTAssertFalse(look.gone)
    }

    func testAReferenceSentFromTheIPhoneCarriesWhatTheDesktopSends() async throws {
        let fixture = try fixture()
        let client = ReferenceClientFake()
        let model = ChatModel(client: client, chatID: fixture.chatId, machineID: "machine", draftRoot: root)
        model.connected = true
        model.referenceSource = ChatReferenceSource(
            items: { ChatReferables.project(views: ProjectWire.stored(fixture.views), chatID: fixture.chatId) }, viewReferences: { true })
        for pick in fixture.picks {
            model.draft += pick.typed
            model.composition.selection = NSRange(location: (model.draft as NSString).length, length: 0)
            let query = try XCTUnwrap(model.draftQuery)
            XCTAssertEqual(query.kind, "#")
            await model.search(query.kind, query: query.text)
            let suggestion = try XCTUnwrap(model.suggestions.first { $0.value == pick.id })
            model.chooseSuggestion(suggestion)
        }
        await model.send()
        let payload = try XCTUnwrap(client.requests.first { $0.0 == .chatSend }?.1)
        XCTAssertEqual(payload.text("text").trimmingCharacters(in: .whitespaces), fixture.send.text)
        XCTAssertEqual(payload.list("chats").compactMap(\.stringValue), fixture.send.chats)
        XCTAssertEqual(payload.list("references").compactMap(\.stringValue), fixture.send.references)
        await model.composition.flush()
    }

    func testAMachineWithoutViewReferencesIsOfferedChatsAndSentNoReferences() async throws {
        let fixture = try fixture()
        let client = ReferenceClientFake()
        let model = ChatModel(client: client, chatID: fixture.chatId, machineID: "machine", draftRoot: root)
        model.connected = true
        model.referenceSource = ChatReferenceSource(
            items: { ChatReferables.project(views: ProjectWire.stored(fixture.views), chatID: fixture.chatId) }, viewReferences: { false })
        await model.search("#", query: "")
        XCTAssertEqual(Set(model.suggestions.compactMap(\.referable?.kind)), ["chat"])
        model.draft = "Ask #Release notes and #Research"
        model.composition.chats = [ChatDraftReference(id: "standalone", title: "Release notes")]
        model.composition.references = [ChatDraftReference(id: "research", title: "Research")]
        await model.send()
        let payload = try XCTUnwrap(client.requests.first { $0.0 == .chatSend }?.1)
        XCTAssertEqual(payload.list("chats").compactMap(\.stringValue), ["standalone"])
        XCTAssertNil(payload["references"])
        await model.composition.flush()
    }

    private let grok = ProviderWire.provider(
        "grok", name: "Grok", models: [ProviderWire.model("grok-4", name: "Grok 4")]
    ).providerInfo

    func testModelSuggestionsStayWhenTheFileSearchFails() async throws {
        let model = ChatModel(client: ReferenceClientFake(files: nil), chatID: "chat", draftRoot: root)
        model.providers = [grok]
        await model.search("@", query: "Grok")
        XCTAssertEqual(model.suggestions.map(\.title), ["Grok 4"])
        XCTAssertNotNil(model.searchProblem)
        await model.composition.flush()
    }

    func testFilesFollowTheModelsWhenTheFileSearchAnswers() async throws {
        let model = ChatModel(client: ReferenceClientFake(files: ["docs/grok.md"]), chatID: "chat", draftRoot: root)
        model.providers = [grok]
        await model.search("@", query: "Grok")
        XCTAssertEqual(model.suggestions.map(\.title), ["Grok 4", "grok.md"])
        XCTAssertNil(model.searchProblem)
        await model.composition.flush()
    }

    func testAHashOpensThePickerOnlyBeforeALetterAndNeverOverAChip() {
        func query(_ text: String) -> ChatDraftQuery? {
            ChatDraftSyntax.query(in: text, selection: NSRange(location: (text as NSString).length, length: 0))
        }
        XCTAssertEqual(query("See #Sk")?.kind, "#")
        XCTAssertNil(query("# Heading"))
        XCTAssertNil(query("Issue #123"))
        XCTAssertNil(query("See #Admin?"))
        XCTAssertNil(query("color#fff"))
        let model = ChatModel(client: ReferenceClientFake(), chatID: "asker", machineID: "machine", draftRoot: root)
        model.referenceSource = ChatReferenceSource(
            items: { [ChatReferable(id: "sketch", name: "Sketch", kind: "drawing", group: .views)] },
            viewReferences: { true })
        model.composition.references = [ChatDraftReference(id: "sketch", title: "Sketch")]
        model.draft = "See #Sketch"
        model.composition.selection = NSRange(location: (model.draft as NSString).length, length: 0)
        XCTAssertNil(model.draftQuery)
    }

    func testTheThreadNamesEveryIdAPersonPointedAtOnce() {
        let items: [ChatItem] = [
            .user(ChatUserItem(id: "u1", createdAt: 1, turnId: "t1", text: "a", chats: ["c1"], references: ["n1"])),
            .user(ChatUserItem(id: "u2", createdAt: 2, turnId: "t2", text: "b", references: ["n1", "v1"])),
        ]
        XCTAssertEqual(ChatReferables.referenced(items), ["c1", "n1", "v1"])
    }

    func testAChipOpensItsViewItsNodeOnItsCanvasOrTheCanvasOfAText() throws {
        let views = ProjectWire.stored(try fixture().views)
        XCTAssertEqual(ChatReferables.destination("sketch", views: views)?.viewID, "sketch")
        XCTAssertEqual(ChatReferables.destination("research", views: views)?.viewID, "main")
        XCTAssertEqual(ChatReferables.destination("research", views: views)?.nodeID, "research")
        XCTAssertEqual(ChatReferables.destination("label", views: views)?.nodeID, "main")
        XCTAssertNil(ChatReferables.destination("gone", views: views))
        let url = try XCTUnwrap(ChatReferables.url("research"))
        XCTAssertEqual(ChatReferables.id(from: url), "research")
    }
}

@MainActor private final class ReferenceClientFake: MachineRequesting {
    var requests: [(WireRequest, JSONValue)] = []
    /// What `fs.search` finds; nil makes it fail the way a timed-out search does.
    let files: [String]?

    init(files: [String]? = []) {
        self.files = files
    }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if type == .fsSearch {
            guard let files else {
                throw MachineClientError.server(code: "not-readable", message: "Cannot search the working folder")
            }
            return .object(["files": .array(files.map { .string($0) })])
        }
        return .object([:])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}

final class ChatReferenceTrailTests: XCTestCase {
    private let canvas: JSONValue = .object([
        "kind": .string("canvas"), "id": .string("board"), "name": .string("Board"),
        "nodes": .array([
            .object(["kind": .string("terminal"), "id": .string("runner"), "title": .string("Runner")])
        ]),
    ])

    func testAChatViewReachesANodeThroughItsCanvas() {
        let chat: JSONValue = .object(["kind": .string("chat"), "id": .string("lead"), "name": .string("Lead")])
        let items = ChatReferables.project(views: ProjectWire.stored([chat, canvas]), chatID: "lead")
        XCTAssertEqual(items.map(\.id), ["board", "runner"])
        XCTAssertEqual(items[1].trail.map(\.name), ["Board"])
    }

    func testAnotherProjectComesBehindTheChatsOwn() {
        let reached: JSONValue = .object([
            "project": .object(["projectId": .string("other"), "name": .string("Other")]),
            "items": .array([.object(["id": .string("note"), "name": .string("Note"), "kind": .string("note")])]),
        ])
        let own = [ChatReferable(id: "board", name: "Board", kind: "canvas", group: .views)]
        let items = ChatReferables.withReached(own, ownID: "mine", ownName: "Mine", reached: [reached])
        XCTAssertEqual(items.map(\.section?.id), ["mine", "other"])
        XCTAssertEqual(items[1].trail.map(\.name), ["Other"])
        XCTAssertEqual(ChatReferables.withReached(own, ownID: "mine", ownName: "Mine", reached: []), own)
    }
}
