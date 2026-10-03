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
/// kept in step with it by hand.
enum ChatLimits {
    /// Nil while the last turn stopped on nothing, or a turn runs. `moment` writes a time a limit names.
    static func view(info: JSONValue, moment: (Double) -> String) -> ChatLimitView? {
        guard let limit = info["limit"], limit != .null, info["activeTurnId"]?.stringValue == nil else { return nil }
        let resumes = info["resumeAt"]?.numberValue.map(moment)
        if limit.text("kind") == "overload" {
            return ChatLimitView(
                title: String(localized: "The model was overloaded"),
                detail: resumes.map { String(localized: "Tries again by itself at \($0).") }
                    ?? String(localized: "Send a message to try again."))
        }
        let resets = limit["resetsAt"]?.numberValue.map(moment)
        return ChatLimitView(
            title: String(localized: "Stopped on a usage limit"),
            detail: resumes.map { String(localized: "Goes on by itself at \($0), when the limit resets.") }
                ?? resets.map { String(localized: "The limit resets at \($0).") })
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

    /// The chat's own "Resume at reset". It only counts while the machine allows it, so with the machine's switch off
    /// it stands off and cannot be turned; absent, it follows the machine.
    static func resumeSwitch(info: JSONValue, machineAllows: Bool) -> (on: Bool, enabled: Bool) {
        (machineAllows && info["resumeAtReset"]?.boolValue != false, machineAllows)
    }

    /// How a session window reads in the account choice: "45% used · resets 14:00".
    static func sessionLine(_ window: AccountSessionWindow, now: Date = .now) -> String {
        let used = String(localized: "\(Int((window.used * 100).rounded()))% used")
        guard let resetsAt = window.resetsAt else { return used }
        return String(localized: "\(used) · resets \(moment(resetsAt, now: now))")
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
                ? ChatForking.message(
                    for: error,
                    update: String(localized: "Update Ruimte on this machine to continue on another account."))
                : String(localized: "Could not continue on \(name). \(error.localizedDescription)")
            return nil
        }
    }

    func setResumeAtReset(_ on: Bool) async {
        do {
            _ = try await client.request("chat.configure", payload: target(["resumeAtReset": .bool(on)]))
            error = nil
        } catch {
            self.error = ChatForking.message(
                for: error, update: String(localized: "Update Ruimte on this machine to resume chats at a reset."))
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

/// A card over the composer while the last turn stopped on a limit: what stopped it, when it goes on, its own Resume
/// at reset, and another account to go on under when one has room.
struct ChatLimitBanner: View {
    let model: ChatModel
    /// The machine's own `resumeAtReset`, which the chat's switch only counts under.
    let resumeAllowed: Bool
    let openFork: (String) -> Void

    var body: some View {
        TimelineView(.everyMinute) { context in
            if let view = ChatLimits.view(info: model.info, moment: { ChatLimits.moment($0, now: context.date) }) {
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Image(lucide: "clock", size: 15).foregroundStyle(MobileStyle.statusNeedsYou)
                                .accessibilityHidden(true)
                            Text(view.title).font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
                                .accessibilityAddTraits(.isHeader)
                        }
                        if let detail = ChatLimits.detail(view, account: model.accountName) {
                            Text(detail).font(.footnote).foregroundStyle(MobileStyle.muted).monospacedDigit()
                        }
                    }
                    resumeToggle
                    if let target = model.continueTarget {
                        Rectangle().fill(MobileStyle.text.opacity(0.08)).frame(height: 1)
                        continueRow(target, now: context.date)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .glassEffect(.regular, in: .rect(cornerRadius: 26))
                .padding(.bottom, 10)
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

    private var resumeToggle: some View {
        let state = ChatLimits.resumeSwitch(info: model.info, machineAllows: resumeAllowed)
        return VStack(alignment: .leading, spacing: 2) {
            Toggle(
                "Resume at reset",
                isOn: Binding(get: { state.on }, set: { on in Task { await model.setResumeAtReset(on) } })
            )
            .font(.subheadline)
            .disabled(!state.enabled || !model.connected)
            if !state.enabled {
                Text("Turned off for this machine. Turn it on in Ruimte's settings on your computer, under Agents.")
                    .font(.caption).foregroundStyle(MobileStyle.muted)
            }
        }
    }

    /// The account with the most room, its window as the account choice reads it, and the way over to it.
    private func continueRow(_ target: ProviderAccountEntry, now: Date) -> some View {
        let name = target.name(provider: usageProviderName(model.provider))
        let window = ProviderAccountList.sessionWindow(model.limits, account: target.id)
        return HStack(spacing: 10) {
            AccountDot(color: target.color, size: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.subheadline).lineLimit(1)
                if let window {
                    Text(ChatLimits.sessionLine(window, now: now))
                        .font(.caption).monospacedDigit().foregroundStyle(ChatRunSettings.tone(window.used))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                Task {
                    if let fork = await model.continueOn(target) { openFork(fork) }
                }
            } label: {
                Text("Continue on")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.onAccent)
                    .padding(.horizontal, 16).frame(minHeight: 34)
                    .background(MobileStyle.accent, in: Capsule())
                    .frame(minHeight: 44).contentShape(Capsule())
            }
            .buttonStyle(ChatComposerButtonStyle())
            .disabled(model.continuing || !model.connected)
            .opacity(model.continuing || !model.connected ? 0.5 : 1)
            .accessibilityLabel("Continue on \(name)")
            .accessibilityHint(
                "Goes on under \(name), which has the most room left. The interrupted turn is sent again.")
        }
    }
}
