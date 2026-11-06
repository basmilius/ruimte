import Foundation
import RuimtePulsar
import SwiftUI

/// The offer to compact before the next message, for a chat whose prompt cache went cold, so that message would pay
/// for the whole thread again, as `chat/logic/resume-compaction.ts` in the desktop's chat makes it.
struct ChatCompactionOffer: Equatable {
    enum Reason: Equatable {
        /// The CLI named when its prompt cache goes cold.
        case cacheExpired
        /// Only the silence says so.
        case idle
    }

    /// The turn the offer is about, and the one Keep full history is remembered for.
    let turnID: String
    let tokens: Int64
    let reason: Reason
}

enum ChatResume {
    /// An absolute count, not a share of the window: reading a thread again costs per token, so 100k in a window of
    /// 1M is as expensive as 100k in a window of 200k.
    static let compactionTokens: Int64 = 100_000
    /// The longest prompt cache Claude keeps is an hour, so past this the whole thread is read again anyway.
    static let idleMilliseconds: Double = 70 * 60_000
    /// English like the other prompts the CLI gets, and it reaches the thread as the person's own message, which it is.
    static let continuePrompt = "Continue."

    /// The turn an offer would be about, with when it ended, or nil while nothing could be offered whatever the time.
    static func offerableTurn(info: ChatInfo, compaction: String?, items: [ChatItem], dismissed: String?) -> (
        id: String, endedAt: Double
    )? {
        guard let compaction, !compaction.isEmpty, compaction != "none" else { return nil }
        guard info.activeTurnId == nil, (info.queue ?? []).isEmpty, info.usage.contextTokens >= compactionTokens
        else { return nil }
        // The newest by when it started, so a thread that arrives out of order still names the turn that ran last.
        var last: ChatTurnItem?
        for item in items {
            if let turn = item.turnItem, last.map({ turn.createdAt >= $0.createdAt }) ?? true {
                last = turn
            }
        }
        guard let turn = last, let endedAt = turn.endedAt, turn.id != dismissed else { return nil }
        // `contextTokens` keeps the old number until the next request, so without this the offer would come straight
        // back after a compaction. A native compaction is a turn without a message of the person.
        let compacted = items.contains {
            if case .compaction(let compaction) = $0 { compaction.turnId == turn.id } else { false }
        }
        return compacted ? nil : (turn.id, endedAt)
    }

    /// When the next message would pay for the whole thread again: when the cache expires, or after a silence longer
    /// than any cache lives from a CLI that names no expiry.
    static func dueAt(info: ChatInfo, endedAt: Double) -> Double {
        info.usage.cacheExpiresAt ?? endedAt + idleMilliseconds
    }

    static func compactionOffer(
        info: ChatInfo, compaction: String?, items: [ChatItem], dismissed: String?, now: Double
    ) -> ChatCompactionOffer? {
        guard let turn = offerableTurn(info: info, compaction: compaction, items: items, dismissed: dismissed),
            now >= dueAt(info: info, endedAt: turn.endedAt)
        else { return nil }
        return ChatCompactionOffer(
            turnID: turn.id, tokens: info.usage.contextTokens,
            reason: info.usage.cacheExpiresAt == nil ? .idle : .cacheExpired)
    }

    /// The turn a person stopped last, when nothing has happened since and Continue can pick it up. A paused queue, a
    /// limit and a paused goal have their own way out, a turn the machine ended has its own resume, and a request
    /// that waits on a person comes first.
    @MainActor static func continuableTurn(info: ChatInfo, items: [ChatItem]) -> String? {
        guard info.activeTurnId == nil, info.status != "needs-you", (info.queue ?? []).isEmpty, info.limit == nil,
            info.goal?.status != .paused
        else { return nil }
        guard let index = items.lastIndex(where: { $0.turnItem != nil }), let turn = items[index].turnItem,
            turn.state == .aborted, turn.limit == nil, !ChatPresentation.abortedByMachine(turn, items: items),
            !abortedByEnd(turn, items: items)
        else { return nil }
        // A message of this turn sits after the turn item too, so only one sent after the turn ended counts.
        let endedAt = turn.endedAt ?? turn.createdAt
        let sentSince = items[(index + 1)...].contains {
            if case .user(let message) = $0 { message.createdAt > endedAt } else { false }
        }
        return sentSince ? nil : turn.id
    }

    // The id of the note a host leaves in a turn it ended because the agent that opened the chat was stopped,
    // `ENDED_NOTE_PREFIX` in the contracts.
    private static func abortedByEnd(_ turn: ChatTurnItem, items: [ChatItem]) -> Bool {
        let turnID = turn.turnId ?? turn.id
        return items.contains {
            guard let note = $0.noteItem else { return false }
            return note.turnId == turnID && note.id.hasPrefix("ended-")
        }
    }
}

/// At the top of the composer when the chat's prompt cache went cold. It blocks nothing: sending keeps the full
/// history, which is what a person who ignores it does.
struct ChatCompactionDock: View {
    let model: ChatModel
    @State private var failure: String?

    var body: some View {
        TimelineView(.everyMinute) { context in
            if let offer = model.compactionOffer(now: context.date) {
                let cold = offer.reason == .cacheExpired
                let tokens = Format.tokens(Double(offer.tokens))
                HStack(spacing: 10) {
                    Image(lucide: "minimize-2", size: 16).foregroundStyle(MobileStyle.faint).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(cold ? String(localized: "Cache expired") : String(localized: "Resume with less context"))
                            .font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(1)
                        Text(
                            cold
                                ? String(localized: "The next message costs \(tokens) tokens at full price")
                                : String(localized: "\(tokens) tokens from earlier")
                        )
                        .font(.caption).monospacedDigit().foregroundStyle(MobileStyle.muted).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    Button(String(localized: "Keep", comment: "Keeps the chat's full history instead of compacting it"))
                    {
                        model.keepFullHistory(offer.turnID)
                    }
                    .buttonStyle(.mobileCapsuleSmall)
                    .accessibilityLabel("Keep full history")
                    Button("Compact") { compact() }
                        .buttonStyle(MobileCapsuleButtonStyle(prominent: true, size: .small))
                        .disabled(!model.connected)
                }
                .chatDockCard()
            }
        }
        .failureAlert("Could not compact", $failure)
    }

    private func compact() {
        Task {
            do {
                _ = try await model.client.request(.chatCompact, payload: model.target())
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}
