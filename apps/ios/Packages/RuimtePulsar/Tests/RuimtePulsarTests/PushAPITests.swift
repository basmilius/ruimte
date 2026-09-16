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
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!)
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
            return (
                Data(#"{"reserved":true}"#.utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
        })
        try await api.startActivity(
            handle: handle, token: String(repeating: "ab", count: 32), machineID: "machine", collapseID: handle,
            accessToken: "access")
        #expect(
            try await api.reserveActivity(
                handle: handle, machineID: "machine", collapseID: handle, accessToken: "access"))
        let sent = await requests.values
        let route = try JSONValue.decode(#require(sent[0].httpBody))
        let reserve = try JSONValue.decode(#require(sent[1].httpBody))
        #expect(route["machineId"] == reserve["machineId"])
        #expect(route["collapseId"] == reserve["collapseId"])
        #expect(reserve["reserve"] == .bool(true))
    }

    @Test func registersAndRoutesActivityTokensToTheMachine() async throws {
        let requests = PushRequests()
        let handle = String(repeating: "A", count: 43)
        let api = PushAPI(fetch: { request in
            await requests.append(request)
            let registration = request.httpMethod == "POST"
            let data = registration ? try JSONValue.object(["handle": .string(handle)]).encoded() : Data()
            return (
                data,
                HTTPURLResponse(
                    url: request.url!, statusCode: registration ? 200 : 204, httpVersion: nil, headerFields: nil)!
            )
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
        #expect(sent.map(\.httpMethod) == ["POST", "PUT", "PUT", "DELETE"])
        #expect(
            sent.allSatisfy {
                $0.value(forHTTPHeaderField: "Authorization") == "Bearer access" && $0.url?.scheme == "https"
            })
        #expect(try JSONValue.decode(#require(sent[1].httpBody))["machineId"] == .string("machine-1"))
        #expect(try JSONValue.decode(#require(sent[2].httpBody))["token"] == .null)
    }

    @Test func refusesBadTokensBeforeSendingAndMalformedRegistrationReplies() async throws {
        let requests = PushRequests()
        let api = PushAPI(fetch: { request in
            await requests.append(request)
            return (
                Data(#"{"handle":"invalid"}"#.utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
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
}
