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
    @ObservationIgnored private var limitReads = 0
    @ObservationIgnored private var accountReads = 0
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
        guard connected else { return }
        accountReads += 1
        let accountAttempt = accountReads
        let generation = generation
        let client = client
        if !reading {
            limitReads += 1
            let attempt = limitReads
            let snapshot = try? await client.request(.usageLimits)
            guard generation == self.generation, self.client === client, !Task.isCancelled else { return }
            if attempt == limitReads, let snapshot {
                limits = snapshot
                problem = nil
            }
        }
        let accounts = try? await client.request(.accountsList)
        guard generation == self.generation, accountAttempt == accountReads, self.client === client, !Task.isCancelled
        else { return }
        if let accounts {
            self.accounts = ProviderAccountList(accounts)
            loginCommands = (accounts["loginCommands"]?.objectValue ?? [:]).compactMapValues(\.stringValue)
        }
    }

    func refresh() async {
        guard connected, !reading else { return }
        limitReads += 1
        let attempt = limitReads
        let generation = generation
        let client = client
        reading = true
        problem = nil
        defer { if generation == self.generation { reading = false } }
        do {
            let snapshot = try await client.request(.usageRefreshLimits)
            guard generation == self.generation, attempt == limitReads, self.client === client, !Task.isCancelled else {
                return
            }
            limits = snapshot
        } catch is CancellationError {
        } catch {
            guard generation == self.generation, attempt == limitReads, self.client === client else { return }
            problem = String(localized: "Could not read limits. Try again.")
        }
    }
}
