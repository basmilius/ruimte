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
        let offered = ChatReferables.project(views: fixture.views, chatID: fixture.chatId)
        XCTAssertEqual(offered.map(\.id), fixture.referables.map(\.id))
        XCTAssertEqual(offered.map(\.name), fixture.referables.map(\.name))
        XCTAssertEqual(offered.map(\.kind), fixture.referables.map(\.kind))
        XCTAssertEqual(offered.map { $0.group == .canvas ? "canvas" : "views" }, fixture.referables.map(\.group))
        XCTAssertEqual(offered.map(\.detail), fixture.referables.map(\.detail))
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
        let offered = ChatReferables.project(views: views, chatID: "chat-lead")
        XCTAssertEqual(offered.map(\.id), ["drawing-sketch", "canvas", "chat-plan"])
        XCTAssertEqual(offered.map(\.mark), ["brain", "frame", "message-square"])
        let lookup = ChatReferenceLookup(items: offered, known: true)
        XCTAssertEqual(ChatReferenceChip.look("drawing-sketch", chat: false, lookup: lookup).icon, "brain")
    }

    func testAReferenceSentFromTheIPhoneCarriesWhatTheDesktopSends() async throws {
        let fixture = try fixture()
        let client = ReferenceClientFake()
        let model = ChatModel(client: client, chatID: fixture.chatId, machineID: "machine", draftRoot: root)
        model.connected = true
        model.referenceSource = ChatReferenceSource(
            items: { ChatReferables.project(views: fixture.views, chatID: fixture.chatId) }, viewReferences: { true })
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
        let payload = try XCTUnwrap(client.requests.first { $0.0 == "chat.send" }?.1)
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
            items: { ChatReferables.project(views: fixture.views, chatID: fixture.chatId) }, viewReferences: { false })
        await model.search("#", query: "")
        XCTAssertEqual(Set(model.suggestions.compactMap(\.referable?.kind)), ["chat"])
        model.draft = "Ask #Release notes and #Research"
        model.composition.chats = [ChatDraftReference(id: "standalone", title: "Release notes")]
        model.composition.references = [ChatDraftReference(id: "research", title: "Research")]
        await model.send()
        let payload = try XCTUnwrap(client.requests.first { $0.0 == "chat.send" }?.1)
        XCTAssertEqual(payload.list("chats").compactMap(\.stringValue), ["standalone"])
        XCTAssertNil(payload["references"])
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
        let views = try fixture().views
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
    var requests: [(String, JSONValue)] = []

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        return .object([:])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
