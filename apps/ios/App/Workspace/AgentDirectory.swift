import Observation
import RuimtePulsar

/// What the machines say of their agent CLIs in `provider.list`: how they call them and whether they can fork. Every
/// read of that list teaches it, so no page keeps a list of CLIs of its own. A CLI no list has named reads as its kind.
@MainActor @Observable
final class AgentDirectory {
    static let shared = AgentDirectory()

    private(set) var names: [String: String] = [:]
    @ObservationIgnored private var forks: [String: Bool] = [:]

    func name(_ kind: String) -> String { names[kind] ?? kind }

    /// Whether the CLI keeps a conversation a fork goes on with: its `fork` capability. Before any machine has
    /// answered, the CLI is not what refuses; the machine refuses a CLI that cannot.
    func canFork(_ kind: String) -> Bool {
        forks.isEmpty || forks[kind] == true
    }

    func learn(_ providers: [ProviderInfo]) {
        for provider in providers {
            let kind = provider.kind
            guard !kind.isEmpty else { continue }
            forks[kind] = ChatForking.canFork(provider)
            let name = provider.name
            if !name.isEmpty, names[kind] != name { names[kind] = name }
        }
    }

    func reset() {
        names = [:]
        forks = [:]
    }
}
