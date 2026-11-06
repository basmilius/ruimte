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
        case failed(String)
    }

    let client: any MachineRequesting
    let kind: String
    let accountID: String
    let name: String
    private(set) var sessionID = AccountLoginModel.newSessionID()
    private(set) var phase = Phase.starting
    /// The account as it read until this login started, which is what a landing has to differ from.
    private var before: AccountStatus?
    private var started = false
    @ObservationIgnored private var live: LiveResource?

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
    private static func reading(_ status: AccountStatus) -> AccountStatus {
        AccountStatus(
            id: status.id, kind: status.kind, state: status.state, email: status.email, plan: status.plan,
            organization: status.organization, home: status.home, transcripts: status.transcripts,
            message: status.message, checkedAt: 0)
    }

    /// Whether a login landed: the account reads logged in, and not the way it read before the login started.
    static func landed(before: AccountStatus?, now: AccountStatus?) -> Bool {
        guard let now, now.state == .ready else { return false }
        guard let before else { return true }
        return reading(before) != reading(now)
    }

    private func status(in accounts: AccountsSnapshot) -> AccountStatus? {
        accounts.statuses.first { $0.id == accountID }
    }

    func begin() async {
        stopWatching()
        // A login lives on one link: reading anything again after a new one would show a terminal that is gone.
        let live = LiveResource(
            client: client,
            events: [
                .apply(.accountsChanged, as: AccountsSnapshot.self) { [weak self] snapshot in
                    guard let self, phase == .running else { return }
                    let now = status(in: snapshot)
                    if Self.landed(before: before, now: now) { phase = .landed(email: now?.email) }
                },
                .apply(.sessionExit, raw: { [weak self] payload in
                    guard let self, payload.text("sessionId") == sessionID, phase == .running else { return }
                    phase = .ended(dropped: false)
                }),
            ],
            connection: { [weak self] available in
                guard let self, !available, phase == .running else { return }
                phase = .ended(dropped: true)
            })
        self.live = live
        live.start()
        before = (try? await client.request(.accountsList).decoded(as: AccountsSnapshot.self))
            .flatMap { status(in: $0) }
        do {
            started = true
            _ = try await client.request(
                .sessionLogin,
                payload: .object([
                    "sessionId": .string(sessionID), "kind": .string(kind), "account": .string(accountID),
                    "cols": .number(Double(Self.cols)), "rows": .number(Double(Self.rows)),
                ]))
            if phase == .starting { phase = .running }
            // Watching is a courtesy: the status still arrives on the machine's own clock.
            _ = try? await client.request(.accountsWatchLogin, payload: .object(["id": .string(accountID)]))
        } catch {
            started = false
            phase = .failed(error.localizedDescription)
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
        _ = try? await client.request(.sessionKill, payload: .object(["sessionId": .string(sessionID)]))
    }

    private func stopWatching() {
        live?.stop()
        live = nil
    }

    var notice: String? {
        switch phase {
        case .starting, .running: nil
        case .landed(let email): email.map { String(localized: "Logged in as \($0)") } ?? String(localized: "Logged in")
        case .ended(let dropped):
            dropped
                ? String(localized: "The machine disconnected, so the login ended.")
                : String(localized: "The login ended.")
        case .failed(let reason): String(localized: "Could not start the login: \(reason)")
        }
    }
}

struct AccountLoginSheet: View {
    @State private var model: AccountLoginModel
    private let kind: String
    @Environment(\.dismiss) private var dismiss

    private var cli: String { AgentDirectory.shared.name(kind) }

    init(client: any MachineRequesting, kind: String, accountID: String, name: String) {
        _model = State(initialValue: AccountLoginModel(client: client, kind: kind, accountID: accountID, name: name))
        self.kind = kind
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Text("\(cli) logs you in here. This closes once you are logged in.")
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
                    MobileLoadingRow(String(localized: "Starting the login")).frame(maxHeight: .infinity)
                case .failed:
                    Spacer()
                default:
                    TerminalScreen(
                        client: model.client, sessionID: model.sessionID,
                        title: String(localized: "Log in to \(model.name)")
                    )
                    .id(model.sessionID)
                }
            }
            .modifier(MobilePageSurface())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
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
