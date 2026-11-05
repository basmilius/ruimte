import Foundation
import RuimtePulsar

/// The check on a link before it opens, the counterpart of `protocolGate` in the desktop client. It asks
/// `endpoint.info` and refuses a machine that does not name its features, since 0.18.0 is the oldest machine a
/// client talks to. Frames that arrive before the answer are held and delivered once the link is open.
@MainActor public final class ProtocolGate {
    /// A request id the link never hands out, since its own ids are UUIDs.
    static let requestID = "protocol"

    private let send: (String) throws -> Void
    private let open: ([String]) -> Void
    private let message: (String) -> Void
    private let refuse: (Error) -> Void
    private var checked = false
    private var held: [String] = []

    public init(
        send: @escaping (String) throws -> Void, open: @escaping ([String]) -> Void,
        message: @escaping (String) -> Void, refuse: @escaping (Error) -> Void
    ) {
        self.send = send
        self.open = open
        self.message = message
        self.refuse = refuse
    }

    /// Asks the machine; call it once the link can carry requests. `client` names this app for the machine's
    /// anonymous usage counts; a machine from before it ignores the field.
    public func start() {
        let frame = JSONValue.object([
            "id": .string(Self.requestID), "type": .string("endpoint.info"),
            "payload": .object(["client": .string("ios")]),
        ])
        do { try send(String(decoding: try frame.encoded(), as: UTF8.self)) } catch { refuse(error) }
    }

    public func receive(_ text: String) {
        if checked {
            message(text)
            return
        }
        guard let frame = try? JSONValue.decode(Data(text.utf8)), frame["id"]?.stringValue == Self.requestID else {
            held.append(text)
            return
        }
        checked = true
        // A machine that refuses `endpoint.info` names no features either, so it is refused as older.
        let answered = frame["ok"]?.boolValue == true
        let features = answered ? frame["result"]?["features"]?.arrayValue : nil
        guard let features else {
            held.removeAll()
            LinkProblems.report(.refused(mismatch: .daemonOlder))
            refuse(TransportFailure.invalid(TransportWords.olderMachine))
            return
        }
        open(features.compactMap(\.stringValue))
        let delivered = held
        held.removeAll()
        delivered.forEach(message)
    }
}
