import Observation
import RuimtePulsar
import RuimteTransport

/// What the machines say of their agent CLIs in `provider.list`: how they call them and whether they can fork. Every
/// read of that list teaches it, so no page keeps a list of CLIs of its own. A CLI no list has named reads as its kind.
@MainActor @Observable
final class AgentDirectory {
    static let shared = AgentDirectory()

    /// Kept per machine, since machines on different versions answer differently for the same CLI.
    private struct MachineForks {
        weak var machine: (any MachineRequesting)?
        let kinds: [String: Bool]
    }

    private(set) var names: [String: String] = [:]
    @ObservationIgnored private var forks: [ObjectIdentifier: MachineForks] = [:]

    func name(_ kind: String) -> String { names[kind] ?? kind }

    /// Whether the CLI keeps a conversation a fork goes on with on this machine: its `fork` capability. Before the
    /// machine has answered, the CLI is not what refuses; the machine refuses a CLI that cannot.
    func canFork(_ kind: String, on machine: any MachineRequesting) -> Bool {
        guard let known = forks[ObjectIdentifier(machine)], known.machine === machine else { return true }
        return known.kinds[kind] == true
    }

    func learn(_ providers: [ProviderInfo], from machine: any MachineRequesting) {
        var kinds: [String: Bool] = [:]
        for provider in providers {
            let kind = provider.kind
            guard !kind.isEmpty else { continue }
            kinds[kind] = ChatForking.canFork(provider)
            let name = provider.name
            if !name.isEmpty, names[kind] != name { names[kind] = name }
        }
        forks[ObjectIdentifier(machine)] = MachineForks(machine: machine, kinds: kinds)
    }

    func reset() {
        names = [:]
        forks = [:]
    }
}
