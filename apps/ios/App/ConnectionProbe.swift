import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit

@MainActor @Observable
final class ConnectionProbe {
    var machine: Machine?
    var status = "Not connected"
    var hello: ServerHelloResult?
    var relayed: Bool?
    var elapsedMilliseconds: Int?
    var history: [String] = []
    private var lease: MachineLease?
    private var startedAt = ContinuousClock.now
    private var helloID: String?
    private var timeout: Task<Void, Never>?

    func connect(_ machine: Machine, runtime: AppRuntime) {
        disconnect()
        self.machine = machine
        guard let key = runtime.key, let broker = machine.brokerUrl, let brokerURL = URL(string: broker), brokerURL.scheme == "wss" else {
            status = "This machine needs a secure broker address."
            return
        }
        status = "Connecting"
        startedAt = .now
        let events = LinkEvents(opened: { [weak self] in
            self?.opened()
        }, message: { [weak self] text in
            self?.receive(text)
        }, closed: { [weak self] error in
            guard let self else { return }
            timeout?.cancel()
            helloID = nil
            hello = nil
            relayed = nil
            status = error?.localizedDescription ?? "Waiting to reconnect"
            record(status)
            startedAt = .now
        }, route: { [weak self] relayed in
            self?.relayed = relayed
        })
        lease = runtime.connections.hold(machineID: machine.id, open: { events in
            let identity = PairingIdentity(machineID: machine.id, machineKey: machine.publicKey, clientKey: key.publicKey)
            return try runtime.pairings.open(identity: identity, requestAccess: {
                guard let token = try await runtime.vault?.accessToken() else {
                    throw AddressBookRequestError(code: "unauthorized", status: 0, message: "Sign in to connect to this machine.")
                }
                let access = try await runtime.client.signalAccess(accessToken: token, machineID: machine.id, key: key, label: "Ruimte on \(UIDevice.current.model)")
                return try JSONValue.decode(JSONEncoder().encode(access))
            }, events: events, makeLink: { access, authenticatedEvents in
                try NativeWebRTCLink(machineID: machine.id, machineKey: machine.publicKey, signer: key,
                                     brokerURL: brokerURL, sockets: runtime.sockets,
                                     iceServers: [.object(["urls": .string("stun:turn.ruimte.app:3478")])],
                                     relayOnly: runtime.relayOnly, access: access, events: authenticatedEvents)
            })
        }, events: events)
    }

    func reconnect(runtime: AppRuntime) {
        guard let machine else { return }
        startedAt = .now
        status = "Reconnecting"
        runtime.connections.reconnect(machineID: machine.id)
    }

    func foregrounded() { startedAt = .now }

    func disconnect() {
        timeout?.cancel()
        timeout = nil
        lease?.release()
        lease = nil
        helloID = nil
        machine = nil
        hello = nil
        relayed = nil
        elapsedMilliseconds = nil
        status = "Not connected"
    }

    private func opened() {
        status = "Reading server.hello"
        let identifier = UUID().uuidString
        helloID = identifier
        // A held connection can announce itself synchronously before hold returns its lease.
        Task { @MainActor [weak self] in
            guard let self, helloID == identifier else { return }
            do {
                let frame = Request(id: identifier, type: "server.hello", payload: .object([:]))
                try lease?.send(String(decoding: JSONEncoder().encode(frame), as: UTF8.self))
                timeout = Task { @MainActor [weak self] in
                    do { try await Task.sleep(for: .seconds(30)) } catch { return }
                    guard let self, helloID == identifier else { return }
                    status = "The machine did not answer server.hello."
                    record(status)
                }
            } catch { status = error.localizedDescription }
        }
    }

    func receive(_ text: String) {
        do {
            let frame = try WireSchema.validate("ServerFrameSchema", JSONValue.decode(Data(text.utf8)))
            guard let pendingID = helloID, frame["id"]?.stringValue == pendingID else { return }
            timeout?.cancel()
            helloID = nil
            guard frame["ok"] == .bool(true), let result = frame["result"] else {
                status = frame["error"]?["message"]?.stringValue ?? "The machine refused server.hello."
                record(status)
                return
            }
            hello = try JSONDecoder().decode(ServerHelloResult.self, from: result.encoded())
            let duration = startedAt.duration(to: .now).components
            elapsedMilliseconds = Int(duration.seconds * 1000 + duration.attoseconds / 1_000_000_000_000_000)
            status = "Connected"
            record("server.hello in \(elapsedMilliseconds ?? 0) ms")
        } catch {
            status = error.localizedDescription
            record(status)
        }
    }

    private func record(_ text: String) {
        history.insert("\(Date.now.formatted(date: .omitted, time: .standard))  \(text)", at: 0)
        if history.count > 20 { history.removeLast(history.count - 20) }
    }
}
