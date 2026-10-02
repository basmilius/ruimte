import Foundation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What a chat that stopped on a limit says about it, read from its info alone.
struct ChatLimitView: Equatable {
    let title: String
    /// When it goes on, or what a person can do; nil when the CLI named no time and nothing is owed.
    let detail: String?
}

/// The limit wording of the desktop client, `limit.*` in `packages/agents-react/src/locales/en/agent-chat.json`,
/// written out by hand since this app has no translation layer.
enum ChatLimits {
    /// Nil while the last turn stopped on nothing, or a turn runs. `moment` writes a time a limit names.
    static func view(info: JSONValue, moment: (Double) -> String) -> ChatLimitView? {
        guard let limit = info["limit"], limit != .null, info["activeTurnId"]?.stringValue == nil else { return nil }
        let resumes = info["resumeAt"]?.numberValue.map(moment)
        if limit.text("kind") == "overload" {
            return ChatLimitView(
                title: "The model was overloaded",
                detail: resumes.map { "Tries again by itself at \($0)." } ?? "Send a message to try again.")
        }
        let resets = limit["resetsAt"]?.numberValue.map(moment)
        return ChatLimitView(
            title: "Stopped on a usage limit",
            detail: resumes.map { "Goes on by itself at \($0), when the limit resets." }
                ?? resets.map { "The limit resets at \($0)." })
    }

    /// A time today as a clock, any other with its day.
    static func moment(_ milliseconds: Double, now: Date = .now, calendar: Calendar = .current) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1000)
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }

    /// With a choice of accounts the line names the one that ran into the limit.
    static func detail(_ view: ChatLimitView, account: String?) -> String? {
        guard let account else { return view.detail }
        return view.detail.map { "\(account) · \($0)" } ?? account
    }

    /// How a session window reads in the account choice: "45% used · resets 14:00".
    static func sessionLine(_ window: AccountSessionWindow, now: Date = .now) -> String {
        let used = "\(Int((window.used * 100).rounded()))% used"
        guard let resetsAt = window.resetsAt else { return used }
        return "\(used) · resets \(moment(resetsAt, now: now))"
    }
}

extension ChatModel {
    var provider: String { info.text("provider") }
    var accountID: String { info["account"]?.stringValue ?? provider }

    /// The account the chat runs under, while its CLI has a choice of accounts.
    var accountChoice: ProviderAccountEntry? {
        guard let accounts, accounts.hasChoice(provider) else { return nil }
        return accounts.entries.first { $0.kind == provider && $0.id == accountID }
    }

    var accountName: String? {
        guard let accounts, accounts.hasChoice(provider) else { return nil }
        return accountChoice?.name(provider: usageProviderName(provider)) ?? accountID
    }

    /// Another account of the chat's CLI with room left, offered once the last turn stopped on a usage limit.
    var continueTarget: ProviderAccountEntry? {
        guard info["limit"]?.text("kind") == "usage", info["activeTurnId"]?.stringValue == nil, let accounts,
            accounts.hasChoice(provider)
        else { return nil }
        return accounts.continueTarget(provider, current: info["account"]?.stringValue, limits: limits)
    }

    /// Reads the plan windows once something shows them. A machine reads an account other than a CLI's default one only
    /// while it is in use, so `unread` asks for the other accounts too, at most every five minutes per machine.
    func readLimits(unread: Bool = false, now: Date = .now) async {
        guard connected else { return }
        if let snapshot = try? await client.request(WireRequest.usageLimits.rawValue, payload: .object([:])) {
            limits = snapshot
        }
        guard unread, let accounts, accounts.hasChoice(provider),
            accounts.hasUnreadAccount(provider, current: info["account"]?.stringValue, limits: limits),
            ChatLimitRefreshes.shared.allow(machineID, now: now)
        else { return }
        if let snapshot = try? await client.request(WireRequest.usageRefreshLimits.rawValue, payload: .object([:])) {
            limits = snapshot
        }
    }

    /// Goes on after the limited turn under another account. Answers the fork to open when the machine went on in one,
    /// and nil when the chat itself went on or the request failed.
    func continueOn(_ account: ProviderAccountEntry) async -> String? {
        guard connected, !continuing else { return nil }
        continuing = true
        defer { continuing = false }
        do {
            let result = try await client.request(
                WireRequest.chatContinueOn.rawValue, payload: target(["account": .string(account.id)]))
            error = nil
            return result["fork"]?["nodeId"]?.stringValue
        } catch {
            let name = account.name(provider: usageProviderName(provider))
            self.error =
                ChatForking.isUnknownRequest(error)
                ? ChatForking.message(for: error, action: "continue on another account")
                : "Could not continue on \(name). \(error.localizedDescription)"
            return nil
        }
    }

    /// From the next turn on, and the default for new agents of this CLI on this machine, as a model pick is.
    func chooseAccount(_ id: String) {
        let provider = provider
        Task {
            if await configure(["account": .string(id)]) {
                ChatPreferences.shared.rememberAccount(id, provider: provider, machineID: machineID)
            }
        }
    }
}

/// Asking for the plan of an account nobody uses starts its CLI, so it is asked at most this often per machine.
@MainActor final class ChatLimitRefreshes {
    static let shared = ChatLimitRefreshes()
    static let interval: TimeInterval = 5 * 60
    private var last: [String: Date] = [:]

    func allow(_ machineID: String, now: Date) -> Bool {
        if let previous = last[machineID], now.timeIntervalSince(previous) < Self.interval { return false }
        last[machineID] = now
        return true
    }
}

/// Over the composer while the last turn stopped on a limit: what stopped it, when it goes on, and another account to
/// go on under when one has room.
struct ChatLimitBanner: View {
    let model: ChatModel
    let openFork: (String) -> Void

    var body: some View {
        TimelineView(.everyMinute) { context in
            if let view = ChatLimits.view(info: model.info, moment: { ChatLimits.moment($0, now: context.date) }) {
                HStack(spacing: 10) {
                    Image(lucide: "hourglass", size: 16).foregroundStyle(MobileStyle.faint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(view.title).font(.subheadline).foregroundStyle(MobileStyle.text)
                        if let detail = ChatLimits.detail(view, account: model.accountName) {
                            Text(detail).font(.caption).foregroundStyle(MobileStyle.muted).monospacedDigit()
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let target = model.continueTarget { continueButton(target) }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .glassEffect(.regular, in: .rect(cornerRadius: 20))
                .padding(.bottom, 8)
                .accessibilityElement(children: .contain)
                .task(id: model.info["limit"]) {
                    if model.info["limit"]?.text("kind") == "usage" && model.accounts?.hasChoice(model.provider) == true
                    {
                        await model.readLimits(unread: true)
                    }
                }
            }
        }
    }

    private func continueButton(_ target: ProviderAccountEntry) -> some View {
        let name = target.name(provider: usageProviderName(model.provider))
        return Button {
            Task {
                if let fork = await model.continueOn(target) { openFork(fork) }
            }
        } label: {
            HStack(spacing: 6) {
                Text("Continue on")
                AccountDot(color: target.color, size: 7)
                Text(name).lineLimit(1)
            }
            .font(.subheadline.weight(.medium))
        }
        .buttonStyle(.bordered)
        .disabled(model.continuing || !model.connected)
        .accessibilityLabel("Continue on \(name)")
        .accessibilityHint("Goes on under \(name), which has the most room left. The interrupted turn is sent again.")
    }
}
