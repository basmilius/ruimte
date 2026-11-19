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

    func request(_ answer: ChatProposalAnswer) -> (request: WireRequest, payload: JSONValue)? {
        switch (self, answer) {
        case (.project(let proposal), .decline):
            (.chatProposalDecline, .object(["proposalId": .string(proposal.proposalId)]))
        case (.project, .confirm):
            nil
        case (.tunnel(let proposal, _), .decline):
            (.tunnelProposalDecline, .object(["proposalId": .string(proposal.proposalId)]))
        case (.tunnel(let proposal, _), .confirm):
            (.tunnelProposalConfirm, .object(["proposalId": .string(proposal.proposalId)]))
        }
    }

    /// What the phone may answer. Making a project is the move dialog of Ruimte on the machine, which the phone does
    /// not have.
    func actions(answers: (WireRequest) -> Bool) -> ChatProposalActions {
        guard let decline = request(.decline), answers(decline.request) else {
            return ChatProposalActions(
                declines: false, confirms: false,
                note: String(localized: "Answer this in Ruimte on the machine, or update Ruimte to answer here."))
        }
        switch self {
        case .project:
            return ChatProposalActions(
                declines: true, confirms: false, note: String(localized: "Make it a project in Ruimte on the machine."))
        case .tunnel(let proposal, _):
            // A stale card can only be declined anywhere, and says so itself.
            if proposal.stale {
                return ChatProposalActions(declines: true, confirms: false, note: nil)
            }
            return ChatProposalActions(declines: true, confirms: answers(.tunnelProposalConfirm), note: nil)
        }
    }
}

enum ChatProposalAnswer {
    case confirm, decline
}

struct ChatProposalActions: Equatable {
    let declines: Bool
    let confirms: Bool
    /// Where the rest of the answer is given.
    let note: String?
}

/// The cards of one chat and the person's answers to them. A card asked again comes under a new id, so what was kept
/// for the old one goes with it.
@MainActor @Observable
final class ChatProposalAnswers {
    private var live: [ChatProposal] = []
    private var answered: Set<String> = []
    private(set) var sending: (id: String, answer: ChatProposalAnswer)?
    private(set) var errors: [String: String] = [:]

    var cards: [ChatProposal] { live.filter { !answered.contains($0.id) } }

    func update(_ cards: [ChatProposal]) {
        live = cards
        let ids = Set(cards.map(\.id))
        answered.formIntersection(ids)
        errors = errors.filter { ids.contains($0.key) }
    }

    func answer(_ card: ChatProposal, _ answer: ChatProposalAnswer, client: any MachineRequesting) async {
        guard sending == nil, let (request, payload) = card.request(answer) else { return }
        let id = card.id
        sending = (id, answer)
        errors[id] = nil
        defer { sending = nil }
        let failure: String
        do {
            let result = try await client.request(request, payload: payload)
            if result["accepted"]?.boolValue == true {
                // Hidden only while the machine still lists it, so a card that comes back shows again.
                if isLive(id) { answered.insert(id) }
                return
            }
            failure = String(localized: "Already answered or expired")
        } catch let error as MachineClientError where answer == .confirm && error.code == .forbidden {
            // An older machine takes a confirm from Ruimte on the machine alone.
            failure = String(localized: "Update Ruimte on the machine to confirm here, or confirm it there.")
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
                    sending: answers.sending?.id == card.id ? answers.sending?.answer : nil,
                    locked: answers.sending != nil,
                    error: answers.errors[card.id], connected: connected
                ) { answer in
                    Task { await answers.answer(card, answer, client: client) }
                }
            }
        }
        .onChange(of: store.cards(for: chatID), initial: true) { _, cards in answers.update(cards) }
        .task(id: store.unread) { await store.readAgainIfFailed() }
    }
}

private struct ChatProposalCard: View {
    let card: ChatProposal
    let actions: ChatProposalActions
    let sending: ChatProposalAnswer?
    let locked: Bool
    let error: String?
    let connected: Bool
    let answer: (ChatProposalAnswer) -> Void

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
            if actions.declines || actions.confirms {
                HStack {
                    Spacer(minLength: 0)
                    if actions.declines {
                        Button(
                            sending == .decline ? String(localized: "Declining…") : String(localized: "Decline")
                        ) { answer(.decline) }
                        .buttonStyle(.mobileCapsuleSmall)
                        .disabled(locked || !connected)
                    }
                    if actions.confirms {
                        Button(
                            sending == .confirm ? String(localized: "Confirming…") : String(localized: "Confirm")
                        ) { answer(.confirm) }
                        .buttonStyle(.mobileCapsuleSmallProminent)
                        .disabled(locked || !connected)
                    }
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
