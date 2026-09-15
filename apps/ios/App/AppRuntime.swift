import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit

@MainActor @Observable
final class AppRuntime {
    var providers: [ProviderId] = []
    var account: Account?
    var machines: [Machine] = []
    var problem: String?
    var signingIn = false
    var signingOut = false
    var loading = false
    var relayOnly = false
    private(set) var key: DeviceKey?
    let client: AddressBookClient
    let sockets = BrokerSockets()
    let connections = MachineConnections()
    private(set) var vault: SessionVault?
    private var authentication: WebAuthentication?
    private var initialized = false
    private var sessionRevision = 0

    init(client: AddressBookClient = AddressBookClient(), vault: SessionVault? = nil) {
        self.client = client
        self.vault = vault
    }

    func start() async {
        guard !initialized else { return }
        initialized = true
        loading = true
        defer { loading = false }
        do {
            let store = KeychainStore()
            let key = try DeviceKey.loadOrCreate(in: store)
            self.key = key
            let vault = SessionVault(client: client, store: store, signer: {
                guard let bytes = try store.readData(account: "device-key") else { return nil }
                return try DeviceKey(rawRepresentation: bytes)
            })
            self.vault = vault
            account = try await vault.restore()?.account
            providers = try await client.providers().compactMap(ProviderId.init(rawValue:))
            if account != nil { await refreshMachines() }
        } catch {
            problem = error.localizedDescription
            initialized = false
        }
    }

    func signIn(_ provider: ProviderId, window: UIWindow) async {
        guard let vault, !signingIn, !signingOut else { return }
        sessionRevision += 1
        let operation = sessionRevision
        signingIn = true
        problem = nil
        defer { signingIn = false; authentication = nil }
        do {
            let authentication = WebAuthentication(anchor: window)
            self.authentication = authentication
            let session = try await authentication.signIn(provider: provider, client: client, vault: vault, label: "Ruimte on \(UIDevice.current.model)")
            guard operation == sessionRevision else { return }
            account = session.account
            await refreshMachines()
        } catch LoginError.cancelled {
            if operation == sessionRevision { problem = "Sign-in was canceled." }
        } catch {
            if operation == sessionRevision { problem = error.localizedDescription }
        }
    }

    func cancelSignIn() { authentication?.cancel() }

    func refreshMachines() async {
        let operation = sessionRevision
        do {
            let token = try await vault?.accessToken()
            guard operation == sessionRevision else { return }
            guard let token else {
                account = nil
                machines = []
                return
            }
            let result = try await client.listMachines(accessToken: token)
            guard operation == sessionRevision else { return }
            machines = result.machines
            problem = nil
        } catch {
            if operation == sessionRevision { problem = error.localizedDescription }
        }
    }

    func signOut() async {
        guard !signingOut else { return }
        signingOut = true
        defer { signingOut = false }
        sessionRevision += 1
        let operation = sessionRevision
        account = nil
        machines = []
        problem = nil
        do {
            try await vault?.signOut()
        } catch {
            if operation == sessionRevision { problem = error.localizedDescription }
        }
    }
}
