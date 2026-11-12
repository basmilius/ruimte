import Observation
import RuimtePulsar
import RuimteTransport

/// The cards in which an agent asks a person what only a person decides: a chat in Chats that would become a
/// project, and a change to a hostname of the machine's tunnel. The machine tells every connection the whole list of
/// each whenever it changes, so one read per connection is enough once it succeeds.
@MainActor @Observable
final class ProposalStore {
    private(set) var projects: [ProjectProposal] = []
    private(set) var tunnels: [TunnelProposal] = []
    /// The lists whose last read failed. With the link up nothing reads them again until a chat shows its cards.
    private(set) var unread: Set<WireRequest> = []
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
        unread = []
    }

    /// Reads again what the last read missed, for a chat that shows its cards now.
    func readAgainIfFailed() async {
        guard !unread.isEmpty else { return }
        await live.refresh()
    }

    /// The cards of one chat, the oldest first.
    func cards(for chatID: String) -> [ChatProposal] {
        let project = projects.filter { $0.chatId == chatID }.map(ChatProposal.project)
        let tunnel = tunnels.filter { $0.chatId == chatID }.compactMap(ChatProposal.init(tunnel:))
        return (project + tunnel).sorted { $0.createdAt < $1.createdAt }
    }

    func setProjects(_ list: [ProjectProposal]) {
        unread.remove(.chatProposals)
        if list != projects { projects = list }
    }

    /// A card this app cannot read stays out alone, so it never blanks the others.
    func setTunnels(_ list: TunnelProposals) {
        unread.remove(.tunnelProposals)
        let next = (list.proposals.arrayValue ?? []).compactMap { try? $0.decoded(as: TunnelProposal.self) }
        if next != tunnels { tunnels = next }
    }

    private func read() async {
        let machine = client as? MachineFeatures
        if machine?.answers(.chatProposals) == true,
            let result = await read(.chatProposals, as: ProjectProposals.self)
        {
            setProjects(result.proposals)
        }
        if machine?.answers(.tunnelProposals) == true,
            let result = await read(.tunnelProposals, as: TunnelProposals.self)
        {
            setTunnels(result)
        }
    }

    private func read<List: Decodable>(_ request: WireRequest, as type: List.Type) async -> List? {
        let result = try? await client.request(request).decoded(as: type)
        guard live.isStarted else { return nil }
        if result == nil { unread.insert(request) }
        return result
    }
}
