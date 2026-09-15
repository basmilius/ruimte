import Foundation
import RuimtePulsar

public struct PairingIdentity: Hashable, Sendable {
    public let machineID: String
    public let machineKey: String
    public let clientKey: String

    public init(machineID: String, machineKey: String, clientKey: String) {
        self.machineID = machineID
        self.machineKey = machineKey
        self.clientKey = clientKey
    }
}

@MainActor public protocol StatementPairingStore {
    func contains(_ identity: PairingIdentity) -> Bool
    func insert(_ identity: PairingIdentity)
}

@MainActor public struct UserDefaultsPairingStore: StatementPairingStore {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func contains(_ identity: PairingIdentity) -> Bool {
        defaults.bool(forKey: storageKey(identity))
    }

    public func insert(_ identity: PairingIdentity) {
        defaults.set(true, forKey: storageKey(identity))
    }

    private func storageKey(_ identity: PairingIdentity) -> String {
        let machineID = Base64URL.encode(Data(identity.machineID.utf8))
        return "ruimte.statement-pairing.v1.\(identity.machineKey).\(identity.clientKey).\(machineID)"
    }
}

@MainActor public final class StatementPairings {
    public typealias Access = () async throws -> JSONValue
    private let store: any StatementPairingStore

    public init(store: (any StatementPairingStore)? = nil) {
        self.store = store ?? UserDefaultsPairingStore()
    }

    public func open(identity: PairingIdentity, requestAccess: @escaping Access, events: LinkEvents,
                     makeLink: (Access?, LinkEvents) throws -> any MachineLink) rethrows -> any MachineLink {
        let access: Access? = store.contains(identity) ? nil : requestAccess
        var authenticatedEvents = events
        var ended = false
        authenticatedEvents.opened = { [store] in
            guard !ended else { return }
            // NativeWebRTCLink opens only after its pinned challenge/proof and direct.accepted.
            store.insert(identity)
            events.opened()
        }
        authenticatedEvents.closed = { error in
            ended = true
            events.closed(error)
        }
        return try makeLink(access, authenticatedEvents)
    }
}
