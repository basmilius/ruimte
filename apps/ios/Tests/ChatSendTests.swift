import Foundation
import RuimtePulsar
import RuimteTransport
import XCTest

#if canImport(Ruimte)
    @testable import Ruimte
#else
    @testable import ComposerChecks
#endif

@MainActor final class ChatSendTests: XCTestCase {
    private var root: URL!
    private var client: ComposerClientFake!
    private var model: ChatModel!

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        client = ComposerClientFake()
        model = ChatModel(client: client, chatID: "chat", machineID: "machine", draftRoot: root)
        model.connected = true
    }

    override func tearDown() async throws {
        await model.composition.flush()
        model = nil
        try? FileManager.default.removeItem(at: root)
    }

    func testSuccessfulSendClearsOnlyTheSubmittedDraft() async throws {
        model.draft = "Read @file.swift using $review"
        model.mentions = ["file.swift", "deleted.swift"]
        model.skills = ["review"]
        model.composition.chats = [ChatDraftReference(id: "related", title: "Related")]
        await model.addAttachment(data: Data("File".utf8), name: "file.txt", mime: "text/plain")
        await model.send()
        let payload = try XCTUnwrap(client.requests.first { $0.0 == "chat.send" }?.1)
        XCTAssertEqual(payload["mentions"], .array([.string("file.swift")]))
        XCTAssertEqual(payload["skills"], .array([.string("review")]))
        XCTAssertEqual(payload["chats"], .array([.string("related")]))
        XCTAssertEqual(payload.list("attachments").first?["data"], .string(Data("File".utf8).base64EncodedString()))
        XCTAssertFalse(model.composition.hasContent)
        XCTAssertFalse(model.sendUncertain)
        XCTAssertTrue(model.composition.chats.isEmpty)
        XCTAssertFalse(ChatComposition(machineID: "machine", chatID: "chat", root: root).hasContent)
    }

    func testTypingAndImportingDuringSendRetainsNewWork() async throws {
        model.draft = "First"
        await model.addAttachment(data: Data("First".utf8), name: "first.txt", mime: "text/plain")
        client.holdSend = true
        let sending = Task { await model.send() }
        await client.waitForSend()
        XCTAssertTrue(ChatComposition(machineID: "machine", chatID: "chat", root: root).deliveryUncertain)
        model.draft = "Second"
        await model.addAttachment(data: Data("Second".utf8), name: "second.txt", mime: "text/plain")
        await model.send()
        XCTAssertEqual(client.requests.filter { $0.0 == "chat.send" }.count, 1)
        client.finishSend()
        await sending.value
        XCTAssertEqual(model.draft, "Second")
        XCTAssertEqual(model.attachments.map(\.name), ["second.txt"])
        XCTAssertFalse(model.sendUncertain)
    }

    func testTimeoutRetainsDraftAndRequiresCheckingAfterReopening() async {
        model.draft = "Keep this"
        client.failure = MachineClientError.timeout("chat.send")
        await model.send()
        XCTAssertTrue(model.sendUncertain)
        XCTAssertFalse(model.canSend)
        XCTAssertEqual(model.draft, "Keep this")
        let restored = ChatModel(client: client, chatID: "chat", machineID: "machine", draftRoot: root)
        XCTAssertTrue(restored.sendUncertain)
        XCTAssertNotNil(restored.sendProblem)
    }

    func testDefiniteServerRejectionAllowsRetry() async {
        model.draft = "Keep this"
        client.failure = MachineClientError.server(code: "invalid", message: "Refused")
        await model.send()
        XCTAssertEqual(model.sendProblem, "Refused")
        XCTAssertFalse(model.sendUncertain)
        XCTAssertTrue(model.canSend)
        client.failure = nil
        await model.send()
        XCTAssertTrue(model.draft.isEmpty)
        XCTAssertNil(model.sendProblem)
    }

    func testUnreadableSendResponseDoesNotInviteADuplicate() async {
        model.draft = "Keep this"
        client.failure = MachineClientError.invalid("Unreadable response")
        await model.send()
        XCTAssertTrue(model.sendUncertain)
        XCTAssertFalse(model.canSend)
        XCTAssertEqual(model.draft, "Keep this")
    }

    func testPendingOrFailedImportPreventsSendingAndOfflineDraftStillSaves() async throws {
        model.draft = "Attach this"
        let id = try XCTUnwrap(model.composition.reserve("File"))
        XCTAssertFalse(model.canSend)
        model.composition.failImport(id, error: DraftFailure("Could not import"))
        XCTAssertFalse(model.canSend)
        model.composition.imports.removeAll()
        XCTAssertTrue(model.canSend)
        model.connected = false
        model.draft += " offline"
        await model.send()
        await model.composition.flush()
        XCTAssertTrue(client.requests.isEmpty)
        XCTAssertEqual(ChatComposition(machineID: "machine", chatID: "chat", root: root).text, "Attach this offline")
    }

    func testEditingQueueMergesDraftAndPreservesContext() async {
        let queued: JSONValue = .object([
            "id": .string("queued"), "text": .string("Earlier"), "skills": .array([.string("review")]),
        ])
        model.info = .object(["queue": .array([queued])])
        model.draft = "New thought"
        await model.queueAction(queued, edit: true)
        XCTAssertEqual(model.draft, "Earlier\n\nNew thought")
        XCTAssertEqual(model.skills, ["review"])
        XCTAssertTrue(model.queue.isEmpty)
        XCTAssertEqual(client.requests.first?.0, "chat.unqueue")
        XCTAssertNil(model.queueProblem)
    }

    func testFailedUnqueueDoesNotChangeEitherMessage() async {
        let queued: JSONValue = .object(["id": .string("queued"), "text": .string("Earlier")])
        model.info = .object(["queue": .array([queued])])
        model.draft = "New thought"
        client.failure = MachineClientError.server(code: "not-queued", message: "Already sent")
        await model.queueAction(queued, edit: true)
        XCTAssertEqual(model.draft, "New thought")
        XCTAssertEqual(model.queue, [queued])
        XCTAssertNotNil(model.queueProblem)
        XCTAssertFalse(model.queueBusy)
    }

    func testInterruptedUnqueueKeepsALocalCopyAndRequiresChecking() async {
        let queued: JSONValue = .object(["id": .string("queued"), "text": .string("Earlier")])
        model.info = .object(["queue": .array([queued])])
        model.draft = "New thought"
        client.failure = MachineClientError.disconnected
        await model.queueAction(queued, edit: true)
        XCTAssertEqual(model.draft, "Earlier\n\nNew thought")
        XCTAssertTrue(model.sendUncertain)
        XCTAssertNotNil(model.queueProblem)
        let restored = ChatComposition(machineID: "machine", chatID: "chat", root: root)
        XCTAssertEqual(restored.text, "Earlier\n\nNew thought")
        XCTAssertTrue(restored.deliveryUncertain)
    }
}

@MainActor private final class ComposerClientFake: MachineRequesting {
    var requests: [(String, JSONValue)] = []
    var failure: MachineClientError?
    var holdSend = false
    private var pendingSend: CheckedContinuation<JSONValue, any Error>?
    private var waiting: CheckedContinuation<Void, Never>?

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if let failure { throw failure }
        if type == "chat.send", holdSend {
            return try await withCheckedThrowingContinuation {
                pendingSend = $0
                waiting?.resume()
                waiting = nil
            }
        }
        return .object([:])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }

    func waitForSend() async {
        if pendingSend != nil { return }
        await withCheckedContinuation { waiting = $0 }
    }

    func finishSend() {
        pendingSend?.resume(returning: .object([:]))
        pendingSend = nil
    }
}
