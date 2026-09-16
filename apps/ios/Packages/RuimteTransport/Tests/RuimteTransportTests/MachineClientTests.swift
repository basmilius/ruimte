import Foundation
import RuimtePulsar
import Testing

@testable import RuimteTransport

@MainActor private final class RequestClock: TransportScheduling {
    var actions: [UUID: @MainActor () -> Void] = [:]
    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void {
        let id = UUID()
        actions[id] = action
        return { self.actions.removeValue(forKey: id) }
    }
    func fire() { for action in Array(actions.values) { action() } }
}

@MainActor struct MachineClientTests {
    @Test func queuedFramesKeepOrderAndDiscardPreviousConnections() async throws {
        let client = MachineClient(send: { _ in }, connected: true)
        var received: [String] = []
        let stop = client.subscribe("session.output") { received.append($0["data"]!.stringValue!) }
        defer { stop() }
        func frame(_ data: String) throws -> String {
            String(
                decoding: try JSONValue.object([
                    "type": .string("event"), "event": .string("session.output"),
                    "payload": .object(["sessionId": .string("s"), "data": .string(data)]),
                ]).encoded(), as: UTF8.self)
        }
        let large = String(repeating: "history 🌍", count: 100_000)
        client.receiveInOrder(try frame(large))
        client.receiveInOrder("invalid JSON")
        await client.receiveInOrder(try frame("delta")).value
        #expect(received == [large, "delta"])
        let stale = client.receiveInOrder(try frame("old connection"))
        client.disconnected()
        client.connected()
        await stale.value
        await client.receiveInOrder(try frame("new connection")).value
        #expect(received == [large, "delta", "new connection"])
    }

    @Test func historyPageIsAppliedBeforeTheFollowingDelta() async throws {
        var client: MachineClient!
        var text = ""
        client = MachineClient(
            send: { frame in
                try answer(
                    client, JSONValue.decode(Data(frame.utf8)),
                    .object([
                        "items": .array([]), "history": .object(["start": .number(0), "cursor": .null]),
                    ]))
                client.receive(
                    #"{"type":"event","event":"chat.event","payload":{"chatId":"c","event":{"type":"delta","itemId":"i","text":" delta"}}}"#
                )
            }, connected: true)
        let stop = client.subscribe("chat.event") { text += $0["event"]?["text"]?.stringValue ?? "" }
        defer { stop() }
        let requesting: any MachineRequesting = client
        _ = try await requesting.request(
            "chat.history", payload: .object(["chatId": .string("c"), "cursor": .string("epoch:1")])
        ) { _ in text = "snapshot" }
        #expect(text == "snapshot delta")
    }

    @Test func initialRoutesPreserveRelayFallbackAndCandidateDeduplication() {
        let host = "candidate:1 1 udp 123 192.168.1.2 4567 typ host"
        let relay = "candidate:2 1 udp 100 203.0.113.2 4568 typ relay"
        let sdp = "v=0\r\na=\(host)\r\n"
        #expect(!PendingIceCandidates.hasInitialRoute("v=0\r\n", relayOnly: false))
        #expect(PendingIceCandidates.hasInitialRoute(sdp, relayOnly: false))
        #expect(!PendingIceCandidates.hasInitialRoute(sdp, relayOnly: true))
        #expect(PendingIceCandidates.hasInitialRoute(sdp + "a=\(relay)\r\n", relayOnly: true))
        var candidates = PendingIceCandidates()
        let hostSignal = JSONValue.object(["candidate": .string(host)])
        let relaySignal = JSONValue.object(["candidate": .string(relay)])
        #expect(candidates.generated(hostSignal) == nil)
        candidates.offered(sdp)
        #expect(candidates.generated(relaySignal) == nil)
        #expect(candidates.answerApplied() == [relaySignal])
        #expect(candidates.generated(hostSignal) == nil)
        #expect(candidates.generated(relaySignal) == nil)
        #expect(candidates.answerApplied().isEmpty)
    }

    private func answer(_ client: MachineClient, _ frame: JSONValue, _ result: JSONValue) throws {
        client.receive(
            String(
                decoding: try JSONValue.object(["id": frame["id"]!, "ok": .bool(true), "result": result]).encoded(),
                as: UTF8.self))
    }

    @Test func routesConcurrentRequestsByIDAndRejectsBadResults() async throws {
        let clock = RequestClock()
        var frames: [JSONValue] = []
        var client: MachineClient!
        client = MachineClient(
            send: { text in
                frames.append(try JSONValue.decode(Data(text.utf8)))
                if frames.count == 2 {
                    try answer(client, frames[1], .object(["time": .number(22)]))
                    try answer(client, frames[0], .object(["time": .number(11)]))
                }
            }, scheduler: clock, connected: true)
        let shared = client!
        async let first = shared.request("server.ping")
        async let second = shared.request("server.ping")
        let values = try await [first, second]
        #expect(Set(values.compactMap { $0["time"]?.numberValue }) == [11, 22])
        #expect(client.pendingRequestCount == 0)
        #expect(clock.actions.isEmpty)
        client = MachineClient(
            send: { text in try answer(client, JSONValue.decode(Data(text.utf8)), .object([:])) }, connected: true)
        await #expect(throws: (any Error).self) { try await client.request("server.ping") }
    }

    @Test func timeoutCancellationAndReconnectDiscardOutstandingRequests() async throws {
        let clock = RequestClock()
        var client: MachineClient!
        client = MachineClient(send: { _ in clock.fire() }, scheduler: clock, connected: true)
        await #expect(throws: MachineClientError.timeout("server.ping")) { try await client.request("server.ping") }
        #expect(client.pendingRequestCount == 0)
        var task: Task<JSONValue, Error>!
        client = MachineClient(send: { _ in task.cancel() }, scheduler: clock, connected: true)
        task = Task { try await client.request("server.ping") }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(client.pendingRequestCount == 0)
        #expect(clock.actions.isEmpty)
        var sends = 0
        client = MachineClient(
            send: { _ in
                sends += 1
                client.disconnected()
                client.connected()
            }, scheduler: clock, connected: true)
        await #expect(throws: MachineClientError.disconnected) { try await client.request("server.ping") }
        #expect(sends == 1)
        #expect(client.pendingRequestCount == 0)
    }

    @Test func validatesRequestsAndFansOutEventsWithoutIDs() async throws {
        var sends = 0
        let client = MachineClient(send: { _ in sends += 1 }, connected: true)
        await #expect(throws: (any Error).self) {
            try await client.request("session.attach", payload: .object(["sessionId": .string("s")]))
        }
        #expect(sends == 0)
        var events: [JSONValue] = []
        let stop = client.subscribe("session.output") { events.append($0) }
        let valid = #"{"type":"event","event":"session.output","payload":{"sessionId":"s","data":"hello"}}"#
        client.receive(valid)
        client.receive(#"{"type":"event","event":"session.output","payload":{"sessionId":"s","data":1}}"#)
        client.receive(
            #"{"id":"unrelated","type":"event","event":"session.output","payload":{"sessionId":"s","data":"ignored"}}"#)
        #expect(events.count == 1)
        stop()
        client.receive(valid)
        #expect(events.count == 1)
        var states: [Bool] = []
        let stopStates = client.observeConnection { states.append($0) }
        client.disconnected()
        client.disconnected()
        client.connected()
        stopStates()
        client.disconnected()
        #expect(states == [true, false, true])
    }

    @Test func watchLeasesKeepOtherWindowsAndRestoreNestedRoots() async throws {
        var client: MachineClient!
        var requests: [String] = []
        client = MachineClient(
            send: { text in
                let frame = try JSONValue.decode(Data(text.utf8))
                requests.append(frame["type"]!.stringValue! + ":" + frame["payload"]!["path"]!.stringValue!)
                try answer(client, frame, .object([:]))
            }, connected: true)
        let parentPayload: JSONValue = .object(["path": .string("/project")])
        let childPayload: JSONValue = .object(["path": .string("/project/src")])
        let parent = client.acquireSubscription(
            start: "fs.watch", stop: "fs.unwatch", payload: parentPayload, stopPayload: parentPayload)
        let child = client.acquireSubscription(
            start: "fs.watch", stop: "fs.unwatch", payload: childPayload, stopPayload: childPayload)
        let childAgain = client.acquireSubscription(
            start: "fs.watch", stop: "fs.unwatch", payload: childPayload, stopPayload: childPayload)
        try await parent.refresh()
        try await child.refresh()
        await parent.release()
        #expect(
            requests == ["fs.watch:/project", "fs.watch:/project/src", "fs.unwatch:/project", "fs.watch:/project/src"])
        await child.release()
        #expect(requests.count == 4)
        await childAgain.release()
        #expect(requests.last == "fs.unwatch:/project/src")
    }

    @Test func attachmentOwnersShareDetachAndSnapshotPrecedesEvents() async throws {
        var client: MachineClient!
        var types: [String] = []
        var ordering: [String] = []
        client = MachineClient(
            send: { text in
                let frame = try JSONValue.decode(Data(text.utf8))
                types.append(frame["type"]!.stringValue!)
                let result: JSONValue =
                    frame["type"] == .string("session.attach")
                    ? .object([
                        "screen": .string("snapshot"), "cols": .number(80), "rows": .number(24), "exited": .bool(false),
                    ]) : .object([:])
                try answer(client, frame, result)
                if frame["type"] == .string("session.attach") {
                    client.receive(
                        #"{"type":"event","event":"session.output","payload":{"sessionId":"s","data":"tail"}}"#)
                }
            }, connected: true)
        let first = client.acquireAttachment("session", id: "s")
        let second = client.acquireAttachment("session", id: "s")
        let stop = client.subscribe("session.output") { _ in ordering.append("event") }
        _ = try await first.snapshot(
            payload: .object(["sessionId": .string("s"), "follow": .bool(true)]),
            onSnapshot: { _ in ordering.append("snapshot") })
        #expect(ordering == ["snapshot", "event"])
        await first.release()
        #expect(types == ["session.attach"])
        await second.release()
        #expect(types == ["session.attach", "session.detach"])
        await second.release()
        #expect(types.count == 2)
        stop()
    }

    @Test func serverErrorsAndSendFailuresReachCallers() async throws {
        var client: MachineClient!
        client = MachineClient(
            send: { text in
                let frame = try JSONValue.decode(Data(text.utf8))
                let reply: JSONValue = .object([
                    "id": frame["id"]!, "ok": .bool(false),
                    "error": .object(["code": .string("conflict"), "message": .string("Reload the project")]),
                ])
                client.receive(String(decoding: try reply.encoded(), as: UTF8.self))
            }, connected: true)
        await #expect(throws: MachineClientError.server(code: "conflict", message: "Reload the project")) {
            try await client.request("server.ping")
        }
        client = MachineClient(send: { _ in throw MachineClientError.disconnected }, connected: true)
        await #expect(throws: MachineClientError.disconnected) { try await client.request("server.ping") }
        #expect(client.pendingRequestCount == 0)
    }
}

@MainActor private final class ResourceMachine: MachineRequesting {
    var replies: [JSONValue]
    var offsets: [Double] = []
    init(_ replies: [JSONValue]) { self.replies = replies }
    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        offsets.append(payload["offset"]!.numberValue!)
        guard !replies.isEmpty else { throw MachineClientError.invalid("Unexpected request") }
        return replies.removeFirst()
    }
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}

@MainActor struct MachineResourceTests {
    private let resource: JSONValue = .object(["kind": .string("file"), "path": .string("/image.png")])
    private func piece(_ text: String, size: Int, offset: Int, version: String = "1") -> JSONValue {
        .object([
            "data": .string(Data(text.utf8).base64EncodedString()), "mime": .string("image/png"),
            "size": .number(Double(size)), "offset": .number(Double(offset)), "version": .string(version),
        ])
    }
    @Test func restartsChangedResourcesAndPreservesByteOrder() async throws {
        let machine = ResourceMachine([
            piece("ab", size: 4, offset: 0), piece("cd", size: 4, offset: 2, version: "2"),
            piece("ef", size: 4, offset: 0, version: "2"), piece("gh", size: 4, offset: 2, version: "2"),
        ])
        let result = try await machine.readResource(resource, chunkBytes: 2)
        #expect(String(decoding: result.data, as: UTF8.self) == "efgh")
        #expect(result.mime == "image/png")
        #expect(machine.offsets == [0, 2, 0, 2])
    }
    @Test func rejectsOversizedEmptyAndOvershootingPieces() async throws {
        for replies in [
            [piece("ab", size: 100, offset: 0)], [piece("", size: 4, offset: 0)], [piece("ab", size: 1, offset: 0)],
        ] {
            let machine = ResourceMachine(replies)
            await #expect(throws: (any Error).self) {
                try await machine.readResource(resource, chunkBytes: 2, maxBytes: 4)
            }
        }
        let empty = try await ResourceMachine([piece("", size: 0, offset: 0)]).readResource(resource)
        #expect(empty.data.isEmpty)
    }
    @Test func repeatedVersionChangesStopAfterOneRestart() async throws {
        let machine = ResourceMachine([
            piece("ab", size: 4, offset: 0), piece("cd", size: 4, offset: 2, version: "2"),
            piece("ef", size: 4, offset: 0, version: "3"), piece("gh", size: 4, offset: 2, version: "4"),
        ])
        await #expect(throws: (any Error).self) { try await machine.readResource(resource, chunkBytes: 2) }
        #expect(machine.offsets == [0, 2, 0, 2])
    }
}
