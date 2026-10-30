import Foundation
import RuimtePulsar
import Testing

@testable import RuimteTransport

@MainActor private struct ImmediateClock: TransportScheduling {
    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void {
        action()
        return {}
    }
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
        let cancelled = client.receiveInOrder(try frame("last frame of old connection"))
        client.disconnected()
        client.connected()
        await stale.value
        await cancelled.value
        await client.receiveInOrder(try frame("new connection")).value
        #expect(received == [large, "delta", "new connection"])
    }

    @Test func orderedValidationRejectsAnEventBeforeDeliveringTheFollowingEvent() async {
        let client = MachineClient(send: { _ in }, connected: true, now: { 0 })
        var delivered: [String] = []
        let stop = client.subscribe("session.output") { payload in
            MainActor.preconditionIsolated()
            #expect(payload["data"] == .string("next"))
            delivered.append("valid")
        }
        let stopRejected = client.subscribeRejected("session.output") { payload in
            MainActor.preconditionIsolated()
            #expect(payload == .object(["sessionId": .string("s"), "data": .number(1)]))
            delivered.append("rejected")
        }
        defer {
            stop()
            stopRejected()
        }
        client.receiveInOrder(#"{"type":"event","event":"session.output","payload":{"sessionId":"s","data":1}}"#)
        await client.receiveInOrder(
            #"{"type":"event","event":"session.output","payload":{"sessionId":"s","data":"next"}}"#
        ).value
        #expect(delivered == ["rejected", "valid"])
        #expect(client.isConnected)
    }

    @Test(arguments: ["success", "server", "invalid"])
    func orderedRepliesValidateResultsAndKeepServerErrors(scenario: String) async throws {
        let clock = FakeScheduler()
        var client: MachineClient!
        var callbacks: [JSONValue] = []
        client = MachineClient(
            send: { text in
                let id = try #require(JSONValue.decode(Data(text.utf8))["id"])
                let frame: JSONValue
                if scenario == "server" {
                    frame = .object([
                        "id": id, "ok": .bool(false),
                        "error": .object(["code": .string("refused"), "message": .string("Try again")]),
                    ])
                } else {
                    frame = .object([
                        "id": id, "ok": .bool(true),
                        "result": .object(["time": scenario == "success" ? .number(42) : .string("wrong")]),
                    ])
                }
                client.receiveInOrder(String(decoding: try frame.encoded(), as: UTF8.self))
            }, scheduler: clock, connected: true, now: { 0 })
        do {
            let value = try await client.request("server.ping", payload: .object([:])) { payload in
                MainActor.preconditionIsolated()
                callbacks.append(payload)
            }
            #expect(scenario == "success")
            #expect(value == .object(["time": .number(42)]))
            #expect(callbacks == [value])
        } catch {
            if scenario == "server" {
                #expect(error as? MachineClientError == .server(code: "refused", message: "Try again"))
            } else {
                #expect(scenario == "invalid")
                #expect(error is WireValidationError)
            }
            #expect(callbacks.isEmpty)
        }
        #expect(client.pendingRequestCount == 0)
        #expect(clock.pending.isEmpty)
    }

    @Test func framesBetweenTheLinkOpeningAndTheClientConnectingWaitForIt() async throws {
        let client = MachineClient(send: { _ in })
        var received: [String] = []
        let stop = client.subscribe("session.output") { received.append($0["data"]?.stringValue ?? "") }
        defer { stop() }
        func frame(_ data: String) -> String {
            #"{"type":"event","event":"session.output","payload":{"sessionId":"s","data":"\#(data)"}}"#
        }
        await client.receiveInOrder(frame("before the link")).value
        client.linkOpened()
        client.receiveInOrder(frame("first"))
        client.receiveInOrder(frame("second"))
        client.connected()
        await client.receiveInOrder(frame("third")).value
        #expect(received == ["first", "second", "third"])

        client.disconnected()
        client.linkOpened()
        client.receiveInOrder(frame("from a link that closed"))
        client.disconnected()
        client.connected()
        await client.receiveInOrder(frame("fourth")).value
        #expect(received == ["first", "second", "third", "fourth"])
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

    private func answer(_ client: MachineClient, _ frame: JSONValue, _ result: JSONValue) throws {
        client.receive(
            String(
                decoding: try JSONValue.object(["id": frame["id"]!, "ok": .bool(true), "result": result]).encoded(),
                as: UTF8.self))
    }

    @Test func routesConcurrentRequestsByIDAndRejectsBadResults() async throws {
        let clock = FakeScheduler()
        var frames: [JSONValue] = []
        var client: MachineClient!
        client = MachineClient(
            send: { text in
                frames.append(try JSONValue.decode(Data(text.utf8)))
                if frames.count == 2 {
                    for frame in frames.reversed() {
                        try answer(
                            client, frame,
                            .object([
                                "kind": .string("text"), "text": frame["payload"]!["path"]!,
                                "encoding": .string("utf-8"), "size": .number(6), "mtime": .number(1),
                            ]))
                    }
                }
            }, scheduler: clock, connected: true)
        let shared = client!
        async let first = shared.request("fs.read", payload: .object(["path": .string("/first")]))
        async let second = shared.request("fs.read", payload: .object(["path": .string("/second")]))
        let values = try await [first, second]
        #expect(values.map { $0["text"] } == [.string("/first"), .string("/second")])
        #expect(client.pendingRequestCount == 0)
        #expect(clock.pending.isEmpty)
        client = MachineClient(
            send: { text in try answer(client, JSONValue.decode(Data(text.utf8)), .object([:])) }, connected: true)
        await #expect(throws: (any Error).self) { try await client.request("server.ping") }
    }

    @Test func timeoutCancellationAndReconnectDiscardOutstandingRequests() async throws {
        let clock = FakeScheduler()
        var client: MachineClient!
        client = MachineClient(send: { _ in clock.advance() }, scheduler: clock, connected: true)
        await #expect(throws: MachineClientError.timeout("server.ping")) { try await client.request("server.ping") }
        #expect(client.pendingRequestCount == 0)
        var task: Task<JSONValue, Error>!
        client = MachineClient(send: { _ in task.cancel() }, scheduler: clock, connected: true)
        task = Task { try await client.request("server.ping") }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(client.pendingRequestCount == 0)
        #expect(clock.pending.isEmpty)
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

    @Test func aReplyThatKeepsArrivingOutlastsTheTimeout() async throws {
        let clock = FakeScheduler()
        var sent: [JSONValue] = []
        let client = MachineClient(
            send: { sent.append(try JSONValue.decode(Data($0.utf8))) }, scheduler: clock, connected: true)
        let history = Task {
            try await client.request(
                "chat.history", payload: .object(["chatId": .string("c"), "cursor": .string("epoch:1")]))
        }
        while sent.isEmpty { await Task.yield() }
        // Each firing is a timeout's worth of a reply coming in piece by piece.
        for _ in 0..<4 {
            client.heard()
            clock.advance()
        }
        #expect(client.pendingRequestCount == 1)
        try answer(
            client, sent[0],
            .object(["items": .array([]), "history": .object(["start": .number(0), "cursor": .null])]))
        _ = try await history.value
        #expect(clock.pending.isEmpty)

        let ping = Task { try await client.request("server.ping") }
        while sent.count < 2 { await Task.yield() }
        client.heard()
        clock.advance()
        clock.advance()
        await #expect(throws: MachineClientError.timeout("server.ping")) { try await ping.value }
    }

    @Test func trafficForOthersDoesNotKeepAnUnansweredReadAlive() async {
        let clock = FakeScheduler()
        var sends = 0
        let client = MachineClient(send: { _ in sends += 1 }, scheduler: clock, connected: true)
        let status = Task { try await client.request("git.status", payload: .object(["cwd": .string("/work")])) }
        while sends == 0 { await Task.yield() }
        for _ in 0..<MachineClient.maxTimeoutRenewals {
            client.heard()
            clock.advance()
        }
        #expect(client.pendingRequestCount == 1)
        client.heard()
        clock.advance()
        await #expect(throws: MachineClientError.timeout("git.status")) { try await status.value }
    }

    @Test func aTimerThatFiresAtOnceTimesOutAfterSomethingWasHeard() async {
        var sends = 0
        let client = MachineClient(send: { _ in sends += 1 }, scheduler: ImmediateClock(), connected: true)
        client.heard()
        await #expect(throws: MachineClientError.timeout("server.ping")) { try await client.request("server.ping") }
        #expect(sends == 0)
    }

    @Test func aMutationWaitsForTheLinkInsteadOfATimer() async throws {
        let clock = FakeScheduler()
        var client: MachineClient!
        client = MachineClient(send: { _ in #expect(clock.pending.isEmpty) }, scheduler: clock, connected: true)
        let push = Task {
            try await client.request(
                "git.action",
                payload: .object(["cwd": .string("/work"), "actionId": .string("push-1"), "kind": .string("push")]))
        }
        while client.pendingRequestCount == 0 { await Task.yield() }
        clock.advance()
        #expect(client.pendingRequestCount == 1)
        client.disconnected()
        await #expect(throws: MachineClientError.disconnected) { try await push.value }
        #expect(!MachineClient.timedRequests.contains(.chatSend))
        #expect(MachineClient.timedRequests.contains(.chatList))
    }

    @Test func anEventThatDoesNotValidateGoesToItsRejectedSubscribers() {
        let client = MachineClient(send: { _ in }, connected: true)
        var events: [JSONValue] = []
        var rejected: [JSONValue] = []
        let stop = client.subscribe("chat.event") { events.append($0) }
        let stopRejected = client.subscribeRejected("chat.event") { rejected.append($0) }
        client.receive(
            #"{"type":"event","event":"chat.event","payload":{"chatId":"c1","event":{"type":"future","x":1}}}"#)
        client.receive(
            #"{"type":"event","event":"chat.event","payload":{"chatId":"c1","event":{"type":"delta","itemId":"i","text":"x"}}}"#
        )
        #expect(events.count == 1)
        #expect(rejected.map { $0["chatId"] } == [.string("c1")])
        stop()
        stopRejected()
        client.receive(
            #"{"type":"event","event":"chat.event","payload":{"chatId":"c1","event":{"type":"future","x":1}}}"#)
        #expect(rejected.count == 1)
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

    @Test func aLoneSurrogateHalfInAReplyReadsAsAReplacementCharacter() async throws {
        let clock = FakeScheduler()
        var client: MachineClient!
        client = MachineClient(
            send: { text in
                let id = try JSONValue.decode(Data(text.utf8))["id"]?.stringValue ?? ""
                let delivery = client.receiveInOrder(
                    #"{"id":"\#(id)","ok":true,"result":{"version":"1","platform":"darwin","home":"/Users/\ud83d"}}"#)
                Task { @MainActor in
                    await delivery.value
                    clock.advance()
                }
            }, scheduler: clock, connected: true)
        let result = try await client.request("server.hello")
        #expect(result["home"] == .string("/Users/\u{FFFD}"))
    }

    @Test func aLoneSurrogateHalfInAnEventReadsAsAReplacementCharacter() {
        let client = MachineClient(send: { _ in }, connected: true)
        var received: [String] = []
        let stop = client.subscribe("session.output") { received.append($0["data"]?.stringValue ?? "") }
        defer { stop() }
        client.receive(#"{"type":"event","event":"session.output","payload":{"sessionId":"s","data":"\udc00 \ud83d"}}"#)
        #expect(received == ["\u{FFFD} \u{FFFD}"])
    }

    @Test func aReplyThatDoesNotDecodeFailsItsRequest() async throws {
        let clock = FakeScheduler()
        var client: MachineClient!
        client = MachineClient(
            send: { text in
                let id = try JSONValue.decode(Data(text.utf8))["id"]?.stringValue ?? ""
                let delivery = client.receiveInOrder(#"{"id":"\#(id)","ok":true,"result":{"time":1}"#)
                Task { @MainActor in
                    await delivery.value
                    clock.advance()
                }
            }, scheduler: clock, connected: true)
        await #expect(throws: MachineClientError.invalid("The machine sent a reply this app cannot read.")) {
            try await client.request("server.ping")
        }
        client = MachineClient(
            send: { text in
                let id = try JSONValue.decode(Data(text.utf8))["id"]?.stringValue ?? ""
                client.receive(#"{"id":"\#(id)","ok":true,"result":{"time":1"#)
                clock.advance()
            }, scheduler: clock, connected: true)
        await #expect(throws: MachineClientError.invalid("The machine sent a reply this app cannot read.")) {
            try await client.request("server.ping")
        }
        #expect(client.pendingRequestCount == 0)
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
        for (reply, message) in [
            (piece("ab", size: 100, offset: 0), "This file is too large to load over this connection."),
            (piece("", size: 4, offset: 0), "The file stopped loading before the end. Try again."),
            (piece("ab", size: 1, offset: 0), "The machine sent part of the file this app cannot read."),
        ] {
            let machine = ResourceMachine([reply])
            await #expect(throws: MachineClientError.invalid(message)) {
                try await machine.readResource(resource, chunkBytes: 2, maxBytes: 4)
            }
            #expect(machine.offsets == [0])
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
