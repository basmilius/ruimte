import Observation
import RuimtePulsar
import RuimteTransport

/// The cards in which an agent asks a person what only a person decides: a chat in Chats that would become a
/// project, and a change to a hostname of the machine's tunnel. The machine tells every connection the whole list of
/// each whenever it changes, so one read per connection is enough.
@MainActor @Observable
final class ProposalStore {
    private(set) var projects: [ProjectProposal] = []
    private(set) var tunnels: [TunnelProposal] = []
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.chatProposals, as: ProjectProposals.self) { [weak self] in self?.setProjects($0.proposals) },
            .apply(.tunnelProposals, as: TunnelProposals.self) { [weak self] in self?.setTunnels($0) },
        ],
        read: { [weak self] in await self?.read() })

    init(client: any MachineRequesting) { self.client = client }

    func start() { live.start() }

    func stop() {
        live.stop()
        projects = []
        tunnels = []
    }

    /// The cards of one chat, the oldest first.
    func cards(for chatID: String) -> [ChatProposal] {
        let project = projects.filter { $0.chatId == chatID }.map(ChatProposal.project)
        let tunnel = tunnels.filter { $0.chatId == chatID }.compactMap(ChatProposal.init(tunnel:))
        return (project + tunnel).sorted { $0.createdAt < $1.createdAt }
    }

    func setProjects(_ list: [ProjectProposal]) {
        if list != projects { projects = list }
    }

    /// A card this app cannot read stays out alone, so it never blanks the others.
    func setTunnels(_ list: TunnelProposals) {
        let next = (list.proposals.arrayValue ?? []).compactMap { try? $0.decoded(as: TunnelProposal.self) }
        if next != tunnels { tunnels = next }
    }

    private func read() async {
        let machine = client as? MachineFeatures
        if machine?.answers(.chatProposals) == true,
            let result = try? await client.request(.chatProposals).decoded(as: ProjectProposals.self), live.isStarted
        {
            setProjects(result.proposals)
        }
        if machine?.answers(.tunnelProposals) == true,
            let result = try? await client.request(.tunnelProposals).decoded(as: TunnelProposals.self), live.isStarted
        {
            setTunnels(result)
        }
    }
}
