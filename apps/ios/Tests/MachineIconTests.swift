import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class MachineIconTests: XCTestCase {
    @MainActor func testPairedMachineLoadsItsIconAndTracksChangesWithoutRefetching() async throws {
        let client = IconMachine()
        let state = MachineIconState(client: client, fallback: nil)
        let initial = NativeTaskDrain { state.start() }
        state.start()
        defer { state.stop() }
        XCTAssertEqual(client.subscriptions, 1)
        await client.waitForRequest(1)
        client.finish(0, icon: "laptop")
        await initial.finish()
        XCTAssertEqual(state.icon, MachineIcon(kind: "lucide", value: "laptop"))
        client.change(icon: "server")
        XCTAssertEqual(state.icon, MachineIcon(kind: "lucide", value: "server"))
        client.change(icon: nil)
        XCTAssertNil(state.icon, "An explicit removal must clear the recorded icon")
        XCTAssertEqual(client.requests, 1)
    }

    @MainActor func testFreshEventAndConnectionRejectOlderInfoResponses() async throws {
        let client = IconMachine()
        let state = MachineIconState(client: client, fallback: nil)
        let initial = NativeTaskDrain { state.start() }
        defer { state.stop() }
        await client.waitForRequest(1)
        client.change(icon: "laptop")
        client.finish(0, icon: "server")
        await initial.finish()
        XCTAssertEqual(state.icon?.value, "laptop")

        client.setConnected(false)
        let older = NativeTaskDrain { client.setConnected(true) }
        await client.waitForRequest(2)
        client.setConnected(false)
        let newer = NativeTaskDrain { client.setConnected(true) }
        await client.waitForRequest(3)
        client.finish(2, icon: "monitor")
        client.finish(1, icon: "pc-case")
        await newer.finish()
        await older.finish()
        XCTAssertEqual(state.icon?.value, "monitor")
    }

    @MainActor func testRequestFailureKeepsFallbackAndStopDropsLateUpdates() async throws {
        let client = IconMachine()
        let fallback = MachineIcon(value: "rocket")
        let state = MachineIconState(client: client, fallback: fallback)
        let initial = NativeTaskDrain { state.start() }
        await client.waitForRequest(1)
        client.fail(0)
        await initial.finish()
        XCTAssertEqual(state.icon, fallback)
        client.setConnected(false)
        let late = NativeTaskDrain { client.setConnected(true) }
        await client.waitForRequest(2)
        state.stop()
        client.finish(1, icon: "laptop")
        await late.finish()
        XCTAssertEqual(state.icon, fallback)
        XCTAssertNil(client.event)
        XCTAssertNil(client.connection)
    }

    @MainActor func testTheMachinesResumeAtResetIsReadAndFollowed() async throws {
        let client = IconMachine()
        let state = MachineIconState(client: client, fallback: nil)
        let initial = NativeTaskDrain { state.start() }
        defer { state.stop() }
        await client.waitForRequest(1)
        client.finish(0, icon: "laptop", extra: ["resumeAtReset": .bool(true)])
        await initial.finish()
        XCTAssertTrue(state.resumeAtReset)
        client.change(icon: "laptop")
        XCTAssertTrue(state.resumeAtReset, "An event that leaves the switch out leaves it as it was")
        client.change(icon: "laptop", extra: ["resumeAtReset": .bool(false)])
        XCTAssertFalse(state.resumeAtReset)
        client.change(icon: "laptop", extra: ["resumeAtReset": .bool(true)])
        XCTAssertTrue(state.resumeAtReset)
        client.setConnected(false)
        let reconnect = NativeTaskDrain { client.setConnected(true) }
        await client.waitForRequest(2)
        client.finish(1, icon: "laptop")
        await reconnect.finish()
        XCTAssertFalse(state.resumeAtReset, "An answer without the switch has it off")
    }

}

@MainActor private final class IconMachine: MachineRequesting {
    var event: (@MainActor @Sendable (JSONValue) -> Void)?
    var connection: (@MainActor @Sendable (Bool) -> Void)?
    var requests = 0
    var subscriptions = 0
    private var pending: [Int: CheckedContinuation<JSONValue, Error>] = [:]
    private let arrival = NativeArrival()

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        XCTAssertEqual(type, .endpointInfo)
        let index = requests
        requests += 1
        return try await withCheckedThrowingContinuation {
            pending[index] = $0
            arrival.record()
        }
    }

    func subscribe(_ name: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        XCTAssertEqual(name, .endpointChanged)
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
        await arrival.wait(for: count)
    }

    func finish(_ index: Int, icon: String, extra: [String: JSONValue] = [:]) {
        pending.removeValue(forKey: index)?.resume(
            returning: .object(
                [
                    "id": .string("machine"), "label": .string("Machine"), "platform": .string("darwin"),
                    "version": .string("1"), "reachability": .string("lan"), "authenticated": .bool(true),
                    "icon": .object(["kind": .string("lucide"), "value": .string(icon)]),
                ].merging(extra) { _, new in new }))
    }

    func fail(_ index: Int) {
        pending.removeValue(forKey: index)?.resume(throwing: MachineClientError.disconnected)
    }

    func change(icon: String?, extra: [String: JSONValue] = [:]) {
        event?(
            .object(
                [
                    "id": .string("machine"), "label": .string("Machine"), "nameSource": .string("chosen"),
                    "icon": icon.map { .object(["kind": .string("lucide"), "value": .string($0)]) } ?? .null,
                ].merging(extra) { _, new in new }))
    }
}
