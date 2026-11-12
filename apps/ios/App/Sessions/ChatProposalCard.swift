import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The changes a tunnel card names, as `TUNNEL_PROPOSAL_ACTIONS` in the contracts. The wire leaves the word open, so a
/// card of a newer machine with another word stays out, as on the desktop: it could not say what it asks.
enum TunnelChange: String {
    case add, on, off, edit, remove
}

/// A card in a chat where its agent asks the person something only a person decides.
enum ChatProposal: Equatable, Identifiable {
    case project(ProjectProposal)
    case tunnel(TunnelProposal, TunnelChange)

    init?(tunnel proposal: TunnelProposal) {
        guard let change = TunnelChange(rawValue: proposal.action) else { return nil }
        self = .tunnel(proposal, change)
    }

    var id: String {
        switch self {
        case .project(let proposal): "project:\(proposal.proposalId)"
        case .tunnel(let proposal, _): "tunnel:\(proposal.proposalId)"
        }
    }

    var createdAt: Double {
        switch self {
        case .project(let proposal): proposal.createdAt
        case .tunnel(let proposal, _): proposal.createdAt
        }
    }

    var heading: String {
        guard case .tunnel(let proposal, let change) = self else {
            return String(localized: "This chat suggests a project")
        }
        let host = proposal.hostname
        let port = proposal.port.map(String.init) ?? ""
        switch change {
        case .add: return String(localized: "Add \(host) → port \(port)")
        case .on where proposal.kind == .mcp: return String(localized: "Turn on \(host) → Ruimte MCP")
        case .on: return String(localized: "Turn on \(host) → port \(port)")
        case .off: return String(localized: "Turn off \(host)")
        case .edit: return String(localized: "Point \(host) → port \(port)")
        case .remove: return String(localized: "Remove \(host)")
        }
    }

    var icon: String {
        if case .project = self { "folder-plus" } else { "globe" }
    }

    var decline: (request: WireRequest, payload: JSONValue) {
        switch self {
        case .project(let proposal):
            (.chatProposalDecline, .object(["proposalId": .string(proposal.proposalId)]))
        case .tunnel(let proposal, _):
            (.tunnelProposalDecline, .object(["proposalId": .string(proposal.proposalId)]))
        }
    }

    /// What the phone may answer. It comes in through the account, never with the machine's local secret, so it is
    /// never the machine's owner: the machine takes a tunnel card's confirm from its owner alone
    /// (`tunnel.proposalConfirm`), and a decline from any client it let in. Making a project is the move dialog of
    /// Ruimte on the machine, which the phone does not have.
    func actions(answers: (WireRequest) -> Bool) -> ChatProposalActions {
        guard answers(decline.request) else {
            return ChatProposalActions(
                declines: false,
                note: String(localized: "Answer this in Ruimte on the machine, or update Ruimte to answer here."))
        }
        switch self {
        case .project:
            return ChatProposalActions(
                declines: true, note: String(localized: "Make it a project in Ruimte on the machine."))
        case .tunnel(let proposal, _):
            // A stale card can only be declined anywhere, and says so itself.
            return ChatProposalActions(
                declines: true,
                note: proposal.stale ? nil : String(localized: "Confirm this in Ruimte on the machine."))
        }
    }
}

struct ChatProposalActions: Equatable {
    let declines: Bool
    /// Where the rest of the answer is given.
    let note: String?
}

/// The cards of one chat and the person's answers to them. A card asked again comes under a new id, so what was kept
/// for the old one goes with it.
@MainActor @Observable
final class ChatProposalAnswers {
    private var live: [ChatProposal] = []
    private var declined: Set<String> = []
    private(set) var sendingID: String?
    private(set) var errors: [String: String] = [:]

    var cards: [ChatProposal] { live.filter { !declined.contains($0.id) } }

    func update(_ cards: [ChatProposal]) {
        live = cards
        let ids = Set(cards.map(\.id))
        declined.formIntersection(ids)
        errors = errors.filter { ids.contains($0.key) }
    }

    func decline(_ card: ChatProposal, client: any MachineRequesting) async {
        guard sendingID == nil else { return }
        let id = card.id
        sendingID = id
        errors[id] = nil
        defer { sendingID = nil }
        let failure: String
        do {
            let (request, payload) = card.decline
            let result = try await client.request(request, payload: payload)
            if result["accepted"]?.boolValue == true {
                // Hidden only while the machine still lists it, so a card that comes back shows again.
                if isLive(id) { declined.insert(id) }
                return
            }
            failure = String(localized: "Already answered or expired")
        } catch {
            failure = error.localizedDescription
        }
        if isLive(id) { errors[id] = failure }
    }

    private func isLive(_ id: String) -> Bool { live.contains { $0.id == id } }
}

/// The cards an agent raised in this chat, above its composer.
struct ChatProposalDock: View {
    let store: ProposalStore
    let chatID: String
    let client: any MachineRequesting
    let connected: Bool
    @State private var answers = ChatProposalAnswers()

    var body: some View {
        VStack(spacing: 0) {
            ForEach(answers.cards) { card in
                ChatProposalCard(
                    card: card,
                    actions: card.actions { (client as? MachineFeatures)?.answers($0) == true },
                    sending: answers.sendingID == card.id, locked: answers.sendingID != nil,
                    error: answers.errors[card.id], connected: connected
                ) {
                    Task { await answers.decline(card, client: client) }
                }
            }
        }
        .onChange(of: store.cards(for: chatID), initial: true) { _, cards in answers.update(cards) }
    }
}

private struct ChatProposalCard: View {
    let card: ChatProposal
    let actions: ChatProposalActions
    let sending: Bool
    let locked: Bool
    let error: String?
    let connected: Bool
    let decline: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(lucide: card.icon, size: 15).foregroundStyle(MobileStyle.statusNeedsYou)
                    .accessibilityHidden(true)
                Text(card.heading).font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            details
            if let note = actions.note {
                Text(note).font(.caption).foregroundStyle(MobileStyle.muted)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(MobileStyle.statusError)
                    .accessibilityLabel("Could not send. \(error)")
            }
            if !connected {
                Label(String(localized: "Not connected"), lucideIcon: "wifi-off").font(.caption)
                    .foregroundStyle(MobileStyle.muted)
            }
            if actions.declines {
                HStack {
                    Spacer(minLength: 0)
                    Button(sending ? String(localized: "Declining…") : String(localized: "Decline"), action: decline)
                        .buttonStyle(.mobileCapsuleSmall)
                        .disabled(locked || !connected)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .chatDockCard(vertical: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.proposal")
    }

    @ViewBuilder private var details: some View {
        switch card {
        case .project(let proposal):
            VStack(alignment: .leading, spacing: 4) {
                Text(proposal.name).font(.subheadline).foregroundStyle(MobileStyle.text)
                if let folder = proposal.folder {
                    Text(folder).font(.system(.caption, design: .monospaced)).foregroundStyle(MobileStyle.muted)
                        .textSelection(.enabled)
                }
                if !proposal.reason.isEmpty {
                    Text(proposal.reason).font(.footnote).foregroundStyle(MobileStyle.muted)
                }
            }
        case .tunnel(let proposal, let change):
            VStack(alignment: .leading, spacing: 4) {
                if let origin = Self.originLine(proposal, change: change) {
                    Text(origin).font(.system(.caption, design: .monospaced)).foregroundStyle(MobileStyle.muted)
                        .textSelection(.enabled)
                }
                if let reason = proposal.reason, !reason.isEmpty {
                    Text(reason).font(.footnote).foregroundStyle(MobileStyle.muted)
                }
                // The machine's settings warn before a dev server goes public, and so does a card that would make one.
                if proposal.kind == .dev && (change == .add || change == .on) && !proposal.stale {
                    Label {
                        Text("Anyone with the address reaches this dev server.")
                    } icon: {
                        Image(lucide: "triangle-alert", size: 12)
                    }
                    .font(.caption).foregroundStyle(MobileStyle.statusNeedsYou)
                }
                if proposal.stale {
                    Text("\(proposal.hostname) changed since the agent asked. Decline this and ask again.")
                        .font(.caption).foregroundStyle(MobileStyle.statusNeedsYou)
                }
            }
        }
    }

    private static func originLine(_ proposal: TunnelProposal, change: TunnelChange) -> String? {
        guard proposal.kind == .dev, change != .off, change != .remove else { return nil }
        var parts: [String] = []
        if proposal.origin?.https == true { parts.append("https") }
        if let header = proposal.origin?.hostHeader { parts.append(String(localized: "Host header \(header)")) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
