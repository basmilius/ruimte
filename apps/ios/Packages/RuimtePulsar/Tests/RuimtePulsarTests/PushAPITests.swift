import Foundation
import Testing

@testable import RuimtePulsar

private actor PushRequests {
    var values: [URLRequest] = []
    func append(_ request: URLRequest) { values.append(request) }
}

struct PushAPITests {
    @Test func automaticActivitiesDoNotRequireASelectedConversation() async throws {
        let requests = PushRequests()
        let api = PushAPI(fetch: { request in
            await requests.append(request)
            return answer(request, status: 204)
        })
        try await api.startActivity(
            handle: String(repeating: "A", count: 43), token: String(repeating: "ab", count: 32), scope: "machines",
            accessToken: "access")
        let sent = await requests.values
        let body = try JSONValue.decode(#require(sent.first?.httpBody))
        #expect(body["scope"] == .string("machines"))
        #expect(body["machineId"] == .null)
        #expect(body["collapseId"] == .null)
    }

    @Test func anIdleAgentProcessDoesNotKeepAnActivityRunning() {
        #expect(PushActivityContentPhase.chat(.object(["status": .string("idle"), "running": .bool(true)])) == .done)
        #expect(PushActivityContentPhase.chat(.object(["status": .string("running")])) == .running)
        #expect(PushActivityContentPhase.chat(.object(["status": .string("needs-you")])) == .needsYou)
    }

    @Test func startRoutingAndForegroundReservationsUseTheSameConversation() async throws {
        let requests = PushRequests()
        let handle = String(repeating: "A", count: 43)
        let api = PushAPI(fetch: { request in
            await requests.append(request)
            return answer(request, body: #"{"reserved":true}"#)
        })
        try await api.startActivity(
            handle: handle, token: String(repeating: "ab", count: 32), machineID: "machine", collapseID: handle,
            accessToken: "access")
        #expect(
            try await api.reserveActivity(
                handle: handle, machineID: "machine", collapseID: handle, accessToken: "access"))
        let sent = await requests.values
        try #require(sent.count == 2)
        #expect(sent.map(\.httpMethod) == ["PUT", "PUT"])
        #expect(
            sent.map { $0.url?.path } == [
                "/v1/push/devices/\(handle)/start-activity", "/v1/push/devices/\(handle)/activities",
            ])
        let route = try JSONValue.decode(#require(sent[0].httpBody))
        let reserve = try JSONValue.decode(#require(sent[1].httpBody))
        #expect(route["machineId"] == .string("machine"))
        #expect(route["collapseId"] == .string(handle))
        #expect(route["token"] == .string(String(repeating: "ab", count: 32)))
        #expect(reserve["machineId"] == .string("machine"))
        #expect(reserve["collapseId"] == .string(handle))
        #expect(reserve["reserve"] == .bool(true))
    }

    @Test func registersAndRoutesActivityTokensToTheMachine() async throws {
        let requests = PushRequests()
        let handle = String(repeating: "A", count: 43)
        let api = PushAPI(fetch: { request in
            await requests.append(request)
            let registration = request.httpMethod == "POST"
            let data = registration ? try JSONValue.object(["handle": .string(handle)]).encoded() : Data()
            return answer(request, status: registration ? 200 : 204, body: data)
        })
        #expect(
            try await api.register(
                token: String(repeating: "ab", count: 32), environment: "sandbox", accessToken: "access") == handle)
        try await api.activity(
            handle: handle, machineID: "machine-1", collapseID: handle, token: String(repeating: "cd", count: 32),
            accessToken: "access")
        try await api.startActivity(handle: handle, token: nil, accessToken: "access")
        try await api.remove(handle: handle, accessToken: "access")
        let sent = await requests.values
        try #require(sent.count == 4)
        #expect(sent.map(\.httpMethod) == ["POST", "PUT", "PUT", "DELETE"])
        #expect(
            sent.map { $0.url?.path } == [
                "/v1/push/devices", "/v1/push/devices/\(handle)/activities",
                "/v1/push/devices/\(handle)/start-activity", "/v1/push/devices/\(handle)",
            ])
        #expect(
            sent.allSatisfy {
                $0.value(forHTTPHeaderField: "Authorization") == "Bearer access" && $0.url?.scheme == "https"
            })
        #expect(try JSONValue.decode(#require(sent[1].httpBody))["machineId"] == .string("machine-1"))
        #expect(try JSONValue.decode(#require(sent[1].httpBody))["collapseId"] == .string(handle))
        #expect(
            try JSONValue.decode(#require(sent[1].httpBody))["token"] == .string(String(repeating: "cd", count: 32)))
        #expect(try JSONValue.decode(#require(sent[2].httpBody))["token"] == .null)
    }

    @Test func refusesBadTokensBeforeSendingAndMalformedRegistrationReplies() async throws {
        let requests = PushRequests()
        let api = PushAPI(fetch: { request in
            await requests.append(request)
            return answer(request, body: #"{"handle":"invalid"}"#)
        })
        await #expect(throws: (any Error).self) {
            try await api.register(token: "bad-token", environment: "sandbox", accessToken: "access")
        }
        #expect(await requests.values.isEmpty)
        await #expect(throws: (any Error).self) {
            try await api.register(
                token: String(repeating: "ab", count: 32), environment: "sandbox", accessToken: "access")
        }
        #expect(await requests.values.count == 1)
    }

    @Test func aLimitAlertDecodesWithAndWithoutItsFields() throws {
        let base = #""kind":"attention","target":"chat","nodeId":"chat","title":"Chat","body":"Codex: weekly limit reached.","expiresAt":1"#
        let limit = try JSONDecoder().decode(
            PushAlertContent.self, from: Data("{\(base),\"timeSensitive\":true,\"resetsAt\":1900000000000}".utf8))
        #expect(limit.timeSensitive == true)
        #expect(limit.resetsAt == 1_900_000_000_000)
        let plain = try JSONDecoder().decode(PushAlertContent.self, from: Data("{\(base)}".utf8))
        #expect(plain.timeSensitive == nil)
        #expect(plain.resetsAt == nil)
    }
}
