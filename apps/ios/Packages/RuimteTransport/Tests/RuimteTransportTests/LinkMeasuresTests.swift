import Foundation
import RuimtePulsar
import Synchronization
import Testing

@testable import RuimteTransport

private final class Measured: Sendable {
    private let measures = Mutex<[LinkMeasure]>([])
    var all: [LinkMeasure] { measures.withLock { $0 } }
    func append(_ measure: LinkMeasure) { measures.withLock { $0.append(measure) } }
}

@MainActor private func measures(during body: () -> Void) -> [LinkMeasure] {
    let measured = Measured()
    LinkMeasures.$observer.withValue({ measured.append($0) }, operation: body)
    return measured.all
}

@MainActor private func measuresAwaiting(_ body: () async -> Void) async -> [LinkMeasure] {
    let measured = Measured()
    await LinkMeasures.$observer.withValue({ measured.append($0) }, operation: body)
    return measured.all
}

@MainActor private final class Stopwatch {
    var milliseconds: Double = 1_000
}

@MainActor struct LinkMeasuresTests {
    private func pool(_ stopwatch: Stopwatch) -> MachineConnections {
        let pool = MachineConnections(scheduler: FakeScheduler(), monitorPaths: false, now: { stopwatch.milliseconds })
        pool.setScene("scene", foreground: true)
        return pool
    }

    @Test func anAttemptThatOpensIsMeasuredOnThePathItOpenedOn() {
        let links = FakeLinks()
        let stopwatch = Stopwatch()
        let pool = pool(stopwatch)
        defer { pool.shutdown() }
        let measured = measures {
            _ = pool.hold(machineID: "machine", open: links.open, events: .ignored)
            stopwatch.milliseconds += 420
            links.last.events.route(.localNetwork)
            links.last.events.opened()
        }
        #expect(measured == [.connected(path: .lan, outcome: .ok, milliseconds: 420)])
    }

    @Test func anAttemptThatClosesBeforeItOpenedFailsWithTheReasonTheLinkGave() {
        let links = FakeLinks()
        let stopwatch = Stopwatch()
        let pool = pool(stopwatch)
        defer { pool.shutdown() }
        let lease = pool.hold(machineID: "machine", open: links.open, events: .ignored)
        defer { lease.release() }
        let failed = measures {
            stopwatch.milliseconds += 20_000
            links.last.events.failing(.timeout)
            links.last.events.closed(TransportFailure.invalid("The direct connection did not come up."))
        }
        #expect(failed == [.connected(path: .direct, outcome: .failed, milliseconds: 20_000), .reconnecting(.timeout)])
        pool.reconnect(machineID: "machine")
        let plain = measures { links.last.events.closed(nil) }
        #expect(plain == [.connected(path: .direct, outcome: .failed, milliseconds: 0), .reconnecting(.failed)])
    }

    @Test func anOpenLinkThatClosesIsADropAndNoFailedAttempt() {
        let links = FakeLinks()
        let pool = pool(Stopwatch())
        defer { pool.shutdown() }
        let lease = pool.hold(machineID: "machine", open: links.open, events: .ignored)
        defer { lease.release() }
        links.last.events.route(.relayed)
        let opened = measures { links.last.events.opened() }
        #expect(opened == [.connected(path: .turn, outcome: .ok, milliseconds: 0)])
        let dropped = measures { links.last.events.closed(TransportFailure.invalid("The direct connection closed.")) }
        #expect(dropped == [.reconnecting(.dropped)])
    }

    @Test func anAskedReconnectIsASwitchAndAResumedSceneIsNone() {
        let links = FakeLinks()
        let pool = pool(Stopwatch())
        defer { pool.shutdown() }
        let lease = pool.hold(machineID: "machine", open: links.open, events: .ignored)
        defer { lease.release() }
        links.last.events.opened()
        let asked = measures { pool.reconnect(machineID: "machine") }
        #expect(asked == [.reconnecting(.switch)])
        let resumed = measures {
            pool.setScene("scene", foreground: false)
            pool.setScene("scene", foreground: true)
        }
        #expect(resumed.isEmpty)
    }

    @Test func aReplyIsMeasuredByThePathOfItsLink() async {
        let stopwatch = Stopwatch()
        var client: MachineClient?
        client = MachineClient(
            send: { text in
                let id = (try? JSONValue.decode(Data(text.utf8)))?["id"]?.stringValue ?? ""
                stopwatch.milliseconds += 35
                client?.receive(#"{"id":"\#(id)","ok":false,"error":{"code":"x","message":"No."}}"#)
            }, connected: true, now: { stopwatch.milliseconds })
        let direct = await measuresAwaiting { _ = try? await client?.request(.serverPing) }
        client?.setRoute(.localNetwork)
        let lan = await measuresAwaiting { _ = try? await client?.request(.serverPing) }

        #expect(direct == [.answered(path: .direct, milliseconds: 35)])
        #expect(lan == [.answered(path: .lan, milliseconds: 35)])
    }

    @Test func aMutationAndAPieceOfBytesAreNotMeasured() async {
        var client: MachineClient?
        client = MachineClient(
            send: { text in
                let id = (try? JSONValue.decode(Data(text.utf8)))?["id"]?.stringValue ?? ""
                client?.receive(#"{"id":"\#(id)","ok":false,"error":{"code":"x","message":"No."}}"#)
            }, connected: true)
        let measured = await measuresAwaiting {
            _ = try? await client?.request(.fsWrite)
            _ = try? await client?.request(.bytesRead)
        }

        #expect(measured.isEmpty)
    }

    @Test func aRequestWithoutAReplyIsNotMeasured() async {
        let clock = FakeScheduler()
        let client = MachineClient(send: { _ in clock.advance() }, scheduler: clock, connected: true)
        let measured = await measuresAwaiting { _ = try? await client.request(.serverPing) }
        #expect(measured.isEmpty)
    }
}
