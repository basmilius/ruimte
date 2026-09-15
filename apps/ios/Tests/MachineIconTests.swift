import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class MachineIconTests: XCTestCase {
    @MainActor func testPairedMachineLoadsItsIconAndTracksChangesWithoutRefetching() async throws {
        let client = IconMachine()
        let state = MachineIconState(client: client, fallback: nil)
        state.start()
        state.start()
        defer { state.stop() }
        XCTAssertEqual(client.subscriptions, 1)
        await client.waitForRequest(1)
        client.finish(0, icon: "laptop")
        await settle()
        XCTAssertEqual(state.icon, MachineIcon(kind: .lucide, value: "laptop"))
        client.change(icon: "server")
        XCTAssertEqual(state.icon, MachineIcon(kind: .lucide, value: "server"))
        client.change(icon: nil)
        XCTAssertNil(state.icon, "An explicit removal must clear the recorded icon")
        XCTAssertEqual(client.requests, 1)
    }

    @MainActor func testFreshEventAndConnectionRejectOlderInfoResponses() async throws {
        let client = IconMachine()
        let state = MachineIconState(client: client, fallback: nil)
        state.start()
        defer { state.stop() }
        await client.waitForRequest(1)
        client.change(icon: "laptop")
        client.finish(0, icon: "server")
        await settle()
        XCTAssertEqual(state.icon?.value, "laptop")

        client.setConnected(false)
        client.setConnected(true)
        await client.waitForRequest(2)
        client.setConnected(false)
        client.setConnected(true)
        await client.waitForRequest(3)
        client.finish(2, icon: "monitor")
        client.finish(1, icon: "pc-case")
        await settle()
        XCTAssertEqual(state.icon?.value, "monitor")
    }

    @MainActor func testRequestFailureKeepsFallbackAndStopDropsLateUpdates() async throws {
        let client = IconMachine()
        let fallback = MachineIcon(kind: .emoji, value: "🚀")
        let state = MachineIconState(client: client, fallback: fallback)
        state.start()
        await client.waitForRequest(1)
        client.fail(0)
        await settle()
        XCTAssertEqual(state.icon, fallback)
        client.setConnected(false)
        client.setConnected(true)
        await client.waitForRequest(2)
        state.stop()
        client.finish(1, icon: "laptop")
        await settle()
        XCTAssertEqual(state.icon, fallback)
        XCTAssertNil(client.event)
        XCTAssertNil(client.connection)
    }

    @MainActor private func settle() async {
        for _ in 0..<20 { await Task.yield() }
    }
}

@MainActor private final class IconMachine: MachineRequesting {
    var event: (@MainActor @Sendable (JSONValue) -> Void)?
    var connection: (@MainActor @Sendable (Bool) -> Void)?
    var requests = 0
    var subscriptions = 0
    private var pending: [Int: CheckedContinuation<JSONValue, Error>] = [:]
    private var waiter: (Int, CheckedContinuation<Void, Never>)?

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        XCTAssertEqual(type, "endpoint.info")
        let index = requests
        requests += 1
        return try await withCheckedThrowingContinuation {
            pending[index] = $0
            if let waiter, requests >= waiter.0 {
                self.waiter = nil
                waiter.1.resume()
            }
        }
    }

    func subscribe(_ name: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        XCTAssertEqual(name, "endpoint.changed")
        subscriptions += 1
        event = handler
        return { self.event = nil }
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        connection = handler
        handler(true)
        return { self.connection = nil }
    }

    func setConnected(_ value: Bool) { connection?(value) }

    func waitForRequest(_ count: Int) async {
        if requests >= count { return }
        await withCheckedContinuation { waiter = (count, $0) }
    }

    func finish(_ index: Int, icon: String) {
        pending.removeValue(forKey: index)?.resume(
            returning: .object([
                "id": .string("machine"), "label": .string("Machine"), "platform": .string("darwin"),
                "version": .string("1"), "reachability": .string("lan"), "authenticated": .bool(true),
                "icon": .object(["kind": .string("lucide"), "value": .string(icon)]),
            ]))
    }

    func fail(_ index: Int) {
        pending.removeValue(forKey: index)?.resume(throwing: MachineClientError.disconnected)
    }

    func change(icon: String?) {
        event?(
            .object([
                "id": .string("machine"), "label": .string("Machine"), "nameSource": .string("chosen"),
                "icon": icon.map { .object(["kind": .string("lucide"), "value": .string($0)]) } ?? .null,
            ]))
    }
}
