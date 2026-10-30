import Observation
import RuimtePulsar
import RuimteTransport

@MainActor @Observable final class UsageLimitsModel {
    private(set) var client: any MachineRequesting
    private(set) var limits: JSONValue?
    private(set) var accounts: ProviderAccountList?
    private(set) var loginCommands: [String: String] = [:]
    private(set) var reading = false
    private(set) var connected = false
    private(set) var problem: String?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var cancelConnection: (() -> Void)?

    init(client: any MachineRequesting) {
        self.client = client
        observe()
    }

    isolated deinit { cancelConnection?() }

    func use(_ client: any MachineRequesting) {
        guard self.client !== client else { return }
        cancelConnection?()
        generation += 1
        self.client = client
        limits = nil
        accounts = nil
        loginCommands = [:]
        problem = nil
        reading = false
        observe()
    }

    private func observe() {
        cancelConnection = client.observeConnection { [weak self] in self?.connected = $0 }
    }

    func load() async {
        guard connected, !reading else { return }
        generation += 1
        let attempt = generation
        let client = client
        let snapshot = try? await client.request(.usageLimits)
        guard attempt == generation, self.client === client, !Task.isCancelled else { return }
        let accounts = try? await client.request(.accountsList)
        guard attempt == generation, self.client === client, !Task.isCancelled else { return }
        if let snapshot { limits = snapshot }
        self.accounts = accounts.map(ProviderAccountList.init)
        loginCommands = (accounts?["loginCommands"]?.objectValue ?? [:]).compactMapValues(\.stringValue)
    }

    func refresh() async {
        guard connected, !reading else { return }
        generation += 1
        let attempt = generation
        let client = client
        reading = true
        problem = nil
        defer { if attempt == generation { reading = false } }
        do {
            let snapshot = try await client.request(.usageRefreshLimits)
            guard attempt == generation, self.client === client, !Task.isCancelled else { return }
            limits = snapshot
        } catch is CancellationError {
        } catch {
            guard attempt == generation, self.client === client else { return }
            problem = error.localizedDescription
        }
    }
}
