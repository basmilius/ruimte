import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The CLI's own login under one of its accounts, in a terminal of its own on the machine (`session.login`), as the
/// desktop runs it for a machine none of its canvases can hold a terminal node of. The machine picks the command, so
/// nothing is held for approval. The session is this login's alone and ends when the sheet closes.
@MainActor @Observable final class AccountLoginModel {
    enum Phase: Equatable {
        case starting
        case running
        case landed(email: String?)
        /// The shell ended, or the connection did, which ends a login on the machine as well.
        case ended(dropped: Bool)
        case outdated
        case failed(String)
    }

    let client: any MachineRequesting
    let kind: String
    let accountID: String
    let name: String
    private(set) var sessionID = AccountLoginModel.newSessionID()
    private(set) var phase = Phase.starting
    /// The account as it read until this login started, which is what a landing has to differ from.
    private var before: JSONValue?
    private var started = false
    private var subscriptions: [() -> Void] = []

    /// A grid a login prints its address and its prompts into; the phone follows it like any other terminal.
    static let cols = 80
    static let rows = 24

    init(client: any MachineRequesting, kind: String, accountID: String, name: String) {
        self.client = client
        self.kind = kind
        self.accountID = accountID
        self.name = name
    }

    private static func newSessionID() -> String { "login-\(UUID().uuidString.lowercased())" }

    /// What the CLI said, without the moment it said it, which a recheck moves without anything changing.
    private static func reading(_ status: JSONValue) -> JSONValue { status.setting("checkedAt", .number(0)) }

    /// Whether a login landed: the account reads logged in, and not the way it read before the login started.
    static func landed(before: JSONValue?, now: JSONValue?) -> Bool {
        guard let now, now.text("state") == "ready" else { return false }
        guard let before else { return true }
        return reading(before) != reading(now)
    }

    private func status(in accounts: JSONValue) -> JSONValue? {
        accounts.list("statuses").first { $0.text("id") == accountID }
    }

    func begin() async {
        stopWatching()
        subscriptions.append(
            client.subscribe("accounts.changed") { [weak self] payload in
                guard let self, phase == .running else { return }
                let now = status(in: payload)
                if Self.landed(before: before, now: now) { phase = .landed(email: now?["email"]?.stringValue) }
            })
        subscriptions.append(
            client.subscribe("session.exit") { [weak self] payload in
                guard let self, payload.text("sessionId") == sessionID, phase == .running else { return }
                phase = .ended(dropped: false)
            })
        subscriptions.append(
            client.observeConnection { [weak self] available in
                guard let self, !available, phase == .running else { return }
                phase = .ended(dropped: true)
            })
        before = (try? await client.request(WireRequest.accountsList.rawValue, payload: .object([:]))).flatMap {
            status(in: $0)
        }
        do {
            started = true
            _ = try await client.request(
                WireRequest.sessionLogin.rawValue,
                payload: .object([
                    "sessionId": .string(sessionID), "kind": .string(kind), "account": .string(accountID),
                    "cols": .number(Double(Self.cols)), "rows": .number(Double(Self.rows)),
                ]))
            if phase == .starting { phase = .running }
            // Watching is a courtesy: the status still arrives on the machine's own clock.
            _ = try? await client.request(WireRequest.accountsWatchLogin.rawValue, payload: .object(["id": .string(accountID)]))
        } catch {
            started = false
            if case MachineClientError.server(code: "unknown-request", message: _) = error {
                phase = .outdated
            } else {
                phase = .failed(error.localizedDescription)
            }
        }
    }

    /// Another attempt in a session of its own; the one before ends first.
    func retry() async {
        await end()
        sessionID = Self.newSessionID()
        phase = .starting
        await begin()
    }

    func end() async {
        stopWatching()
        guard started else { return }
        started = false
        _ = try? await client.request(WireRequest.sessionKill.rawValue, payload: .object(["sessionId": .string(sessionID)]))
    }

    private func stopWatching() {
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
    }

    var notice: String? {
        switch phase {
        case .starting, .running: nil
        case .landed(let email): email.map { "Logged in as \($0)" } ?? "Logged in"
        case .ended(let dropped):
            dropped ? "The connection to the machine dropped, which ended the login." : "The login ended."
        case .outdated:
            "This machine needs an update before you can log in from here. Update Ruimte on it, or log in on the machine."
        case .failed(let reason): "The login could not start: \(reason)"
        }
    }
}

struct AccountLoginSheet: View {
    @State private var model: AccountLoginModel
    let cli: String
    @Environment(\.dismiss) private var dismiss

    init(client: any MachineRequesting, kind: String, accountID: String, name: String) {
        _model = State(initialValue: AccountLoginModel(client: client, kind: kind, accountID: accountID, name: name))
        cli = ProcessesText.agentName(kind)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Text("\(cli) runs its own login in this terminal. It closes by itself once you are logged in.")
                    .font(.caption).foregroundStyle(MobileStyle.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                if let notice = model.notice {
                    HStack {
                        Text(notice).font(.callout)
                        Spacer()
                        switch model.phase {
                        case .ended, .failed:
                            Button("Try again") { Task { await model.retry() } }
                        default:
                            EmptyView()
                        }
                    }
                    .padding().background(.regularMaterial)
                }
                switch model.phase {
                case .starting:
                    MobileLoadingRow("Starting the login").frame(maxHeight: .infinity)
                case .outdated, .failed:
                    Spacer()
                default:
                    TerminalScreen(client: model.client, sessionID: model.sessionID, title: "Log in to \(model.name)")
                        .id(model.sessionID)
                }
            }
            .modifier(MobilePageSurface())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
        .task { await model.begin() }
        .onDisappear { Task { await model.end() } }
        .task(id: model.phase) {
            // Long enough to read that it worked, short enough not to wait on it.
            guard case .landed = model.phase else { return }
            try? await Task.sleep(for: .milliseconds(1200))
            dismiss()
        }
    }
}
