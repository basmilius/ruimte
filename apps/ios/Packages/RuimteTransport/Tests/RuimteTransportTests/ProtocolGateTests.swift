import Foundation
import RuimtePulsar
import Testing

@testable import RuimteTransport

@MainActor private final class GateProbe {
    var sent: [String] = []
    var features: [String]?
    var delivered: [String] = []
    var refusal: Error?
    lazy var gate = ProtocolGate(
        send: { [unowned self] in sent.append($0) }, open: { [unowned self] in features = $0 },
        message: { [unowned self] in delivered.append($0) }, refuse: { [unowned self] in refusal = $0 })
}

private func info(_ result: String) -> String {
    #"{"id":"protocol","ok":true,"result":\#(result)}"#
}

private func event(_ name: String) -> String {
    #"{"type":"event","event":"\#(name)","payload":{}}"#
}

@MainActor struct ProtocolGateTests {
    @Test func startAsksForTheEndpointInfo() throws {
        let probe = GateProbe()
        probe.gate.start()
        let frame = try JSONValue.decode(Data(try #require(probe.sent.first).utf8))
        #expect(frame["id"]?.stringValue == "protocol")
        #expect(frame["type"]?.stringValue == "endpoint.info")
        #expect(frame["payload"]?["client"]?.stringValue == "ios")
    }

    @Test func aMachineWithoutFeaturesIsRefusedAsOlder() throws {
        let probe = GateProbe()
        probe.gate.receive(event("chat.status"))
        probe.gate.receive(info(#"{"protocol":1}"#))
        #expect(probe.refusal as? TransportFailure == .invalid(TransportWords.olderMachine))
        #expect(probe.features == nil)
        #expect(probe.delivered.isEmpty)
    }

    @Test func aMachineWithFeaturesOpensAndDeliversHeldFramesInOrder() {
        let probe = GateProbe()
        probe.gate.receive(event("first"))
        probe.gate.receive(event("second"))
        #expect(probe.features == nil)
        probe.gate.receive(info(#"{"features":["chat.status","git.status"]}"#))
        #expect(probe.features == ["chat.status", "git.status"])
        #expect(probe.delivered == [event("first"), event("second")])
        probe.gate.receive(event("third"))
        #expect(probe.delivered.last == event("third"))
        #expect(probe.refusal == nil)
    }

    @Test func aMachineThatRefusesTheEndpointInfoIsRefusedAsOlder() {
        let probe = GateProbe()
        probe.gate.receive(event("chat.status"))
        probe.gate.receive(#"{"id":"protocol","ok":false,"error":{"code":"internal","message":"No"}}"#)
        #expect(probe.refusal as? TransportFailure == .invalid(TransportWords.olderMachine))
        #expect(probe.features == nil)
        #expect(probe.delivered.isEmpty)
    }

    @Test func aLinkThatReportsFeaturesHandsThemToEveryMemberBeforeItOpens() {
        let connections = MachineConnections(scheduler: TaskTransportScheduler(), monitorPaths: false)
        connections.setScene("scene", foreground: true)
        defer { connections.shutdown() }
        let links = FakeLinks()
        var order: [String] = []
        let member = LinkEvents(
            opened: { order.append("opened") }, message: { _ in }, closed: { _ in },
            features: { order.append("features \($0.joined(separator: ","))") })
        let first = connections.hold(machineID: "machine", open: links.open, events: member)
        let events = links.last.events
        events.features(["git.status"])
        events.opened()
        #expect(order == ["features git.status", "opened"])
        order.removeAll()
        let second = connections.hold(machineID: "machine", open: links.open, events: member)
        #expect(order == ["features git.status", "opened"])
        #expect(links.all.count == 1)
        events.closed(nil)
        first.release()
        second.release()
    }

    @Test func aClientAnswersOnlyWhatTheOpenLinkNames() {
        let client = MachineClient(send: { _ in })
        #expect(!client.answers(.gitStatus))
        client.setFeatures(["git.status"])
        #expect(client.answers(.gitStatus))
        #expect(!client.answers(.gitLog))
        client.disconnected()
        #expect(!client.answers(.gitStatus))
    }
}
