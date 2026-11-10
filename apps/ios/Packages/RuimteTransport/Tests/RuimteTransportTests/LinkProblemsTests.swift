import Foundation
import RuimtePulsar
import Synchronization
import Testing

@testable import RuimteTransport

private final class Heard: Sendable {
    private let problems = Mutex<[LinkProblem]>([])
    var all: [LinkProblem] { problems.withLock { $0 } }
    func append(_ problem: LinkProblem) { problems.withLock { $0.append(problem) } }
}

@MainActor private func problems(during body: () -> Void) -> [LinkProblem] {
    let heard = Heard()
    LinkProblems.$observer.withValue({ heard.append($0) }, operation: body)
    return heard.all
}

@MainActor private func problemsAwaiting(_ body: () async -> Void) async -> [LinkProblem] {
    let heard = Heard()
    await LinkProblems.$observer.withValue({ heard.append($0) }, operation: body)
    return heard.all
}

@MainActor struct LinkProblemsTests {
    @Test func anOpenLinkThatClosesOnItsOwnAndStaysDownIsADrop() {
        let links = FakeLinks()
        let clock = FakeScheduler()
        let pool = MachineConnections(scheduler: clock, monitorPaths: false)
        pool.setScene("scene", foreground: true)
        let lease = pool.hold(machineID: "machine", open: links.open, events: .ignored)
        defer {
            lease.release()
            pool.shutdown()
        }
        let lost = TransportFailure.invalid("The direct connection closed.")
        let beforeOpening = problems { links.last.events.closed(lost) }
        #expect(beforeOpening.isEmpty)
        pool.reconnect(machineID: "machine")
        links.last.events.opened()
        let whileOpen = problems {
            links.last.events.closed(lost)
            clock.advance()
        }
        #expect(whileOpen == [.dropped])
        #expect(clock.delays.contains(MachineConnections.dropGraceMs))
    }

    @Test func aDropTheReconnectMendsIsNoReport() {
        let links = FakeLinks()
        let clock = FakeScheduler()
        let pool = MachineConnections(scheduler: clock, monitorPaths: false)
        pool.setScene("scene", foreground: true)
        let lease = pool.hold(machineID: "machine", open: links.open, events: .ignored)
        defer {
            lease.release()
            pool.shutdown()
        }
        links.last.events.opened()
        let heard = problems {
            links.last.events.closed(TransportFailure.invalid("The direct connection closed."))
            pool.reconnect(machineID: "machine")
            links.last.events.opened()
            clock.advance()
        }
        #expect(heard.isEmpty)
    }

    @Test func aLinkThisPhoneLetsGoIsNoDrop() {
        let links = FakeLinks()
        let pool = MachineConnections(scheduler: FakeScheduler(), monitorPaths: false)
        pool.setScene("scene", foreground: true)
        let lease = pool.hold(machineID: "machine", open: links.open, events: .ignored)
        links.last.events.opened()
        let heard = problems {
            pool.setScene("scene", foreground: false)
            pool.forget(machineID: "machine")
            lease.release()
            pool.shutdown()
        }
        #expect(heard.isEmpty)
    }

    @Test func aReadWithoutAnAnswerIsATimeout() async {
        let clock = FakeScheduler()
        let client = MachineClient(send: { _ in clock.advance() }, scheduler: clock, connected: true)
        let heard = await problemsAwaiting { _ = try? await client.request(.serverPing) }
        #expect(heard == [.timeout(request: "server.ping")])
    }

    @Test func aMachineWithoutFeaturesIsRefusedAsOlder() {
        let gate = ProtocolGate(send: { _ in }, open: { _ in }, message: { _ in }, refuse: { _ in })
        let heard = problems { gate.receive(#"{"id":"protocol","ok":true,"result":{"protocol":1}}"#) }
        #expect(heard == [.refused(mismatch: .daemonOlder)])
    }

    @Test func aChallengeOnAnotherWireVersionNamesWhichSide() {
        let machine = DeviceKey()
        let heard = [Double(WireConstants.protocolVersion) - 1, Double(WireConstants.protocolVersion) + 1].flatMap {
            version in
            let challenge: JSONValue = .object([
                "type": .string("direct.challenge"), "protocol": .number(version), "challenge": .string("nonce"),
                "daemon": .object([
                    "id": .string("machine"), "publicKey": .string(machine.publicKey), "signature": .string("x"),
                ]),
            ])
            return problems {
                _ = try? DirectIdentity.proof(
                    challenge: challenge, binding: "binding", machineID: "machine", machineKey: machine.publicKey,
                    signer: machine)
            }
        }
        #expect(heard == [.refused(mismatch: .daemonOlder), .refused(mismatch: .daemonNewer)])
    }
}
