import Observation
import RuimtePulsar
import RuimteShared
import RuimteTransport
import SwiftUI

struct MachineClientAccess: Identifiable, Equatable {
    let id: String
    let label: String
    /// `link` or `statement`; absent means a link.
    let origin: String
    let createdAt: Date
    let lastSeenAt: Date
    let current: Bool

    init(_ value: JSONValue) {
        id = value.text("id")
        label = value.text("label", fallback: String(localized: "Unnamed device"))
        origin = value.text("origin", fallback: "link")
        createdAt = Date(timeIntervalSince1970: value.number("createdAt") / 1000)
        lastSeenAt = Date(timeIntervalSince1970: value.number("lastSeenAt") / 1000)
        current = value["current"]?.boolValue == true
    }

    var icon: String {
        if current { return "smartphone" }
        let lowered = label.lowercased()
        if ["iphone", "ipad", "android"].contains(where: lowered.contains) { return "smartphone" }
        if ["safari", "chrome", "firefox", "edge", "station", "browser"].contains(where: lowered.contains) {
            return "globe"
        }
        return "laptop"
    }

    func detail(now: Date = Date()) -> String {
        let since = Format.day(createdAt)
        let seen = Format.ago(milliseconds: now.timeIntervalSince(lastSeenAt) * 1000)
        return origin == "statement"
            ? String(
                localized: "Signed in through an account \(since) · last seen \(seen)",
                comment: "%1$@ is a date, %2$@ a relative time")
            : String(localized: "Paired with a link \(since) · last seen \(seen)", comment: "%1$@ is a date, %2$@ a relative time")
    }

    var revokeMessage: String {
        if current {
            return String(
                localized: "This is the device you are using. It loses access to this machine and forgets it here.")
        }
        if origin == "statement" {
            return String(
                localized:
                    "It loses access the next time it connects, and signing in through an account will not let it back in."
            )
        }
        return String(localized: "It loses access the next time it connects.")
    }
}

@MainActor @Observable
final class MachineAccess {
    private(set) var clients: [MachineClientAccess] = []
    private(set) var loaded = false
    let state = RemotePageState()
    @ObservationIgnored private let client: any MachineRequesting

    init(client: any MachineRequesting) {
        self.client = client
    }

    func load() async {
        await state.read(loaded: !clients.isEmpty) { stillTheLatest in
            let result = try await client.request(.authSessions)
            try stillTheLatest()
            clients = result.list("sessions").map(MachineClientAccess.init)
                .sorted { ($0.current ? 1 : 0, $0.lastSeenAt) > ($1.current ? 1 : 0, $1.lastSeenAt) }
            loaded = true
        }
    }

    func revoke(_ access: MachineClientAccess) async -> Bool {
        var revoked = false
        await state.perform {
            _ = try await client.request(.authRevoke, payload: .object(["id": .string(access.id)]))
            clients.removeAll { $0.id == access.id }
            revoked = true
        }
        return revoked
    }
}

/// The desktop's Apps with access: every client with access to the machine, how it came in and when it was there.
struct MachineAccessSheet: View {
    let session: SharedMachineSession
    let runtime: AppRuntime
    let name: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            MobileForm {
                MachineClientsSection(session: session)
                MachineAccessSection(session: session, runtime: runtime, name: name)
            }
            .navigationTitle("Apps with access")
            .navigationSubtitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(role: .close) { dismiss() } }
            }
        }
    }
}

/// The clients of a machine with Revoke, as a section of whichever form shows them: the iPhone's sheet of its own, or
/// the iPad's one sheet with the machine's name and icon.
struct MachineAccessSection: View {
    let session: SharedMachineSession
    let runtime: AppRuntime
    let name: String
    @State private var access: MachineAccess
    @State private var revoking: MachineClientAccess?
    @Environment(\.dismiss) private var dismiss

    init(session: SharedMachineSession, runtime: AppRuntime, name: String) {
        self.session = session
        self.runtime = runtime
        self.name = name
        _access = State(initialValue: MachineAccess(client: session.rpc))
    }

    var body: some View {
        Section {
            if access.state.loading {
                MobileLoadingRow(String(localized: "Loading devices")).frame(maxWidth: .infinity)
            }
            ForEach(access.clients) { client in
                HStack(spacing: MobileSpacing.medium) {
                    HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.medium) {
                        MobileStatusGlyph(tone: .idle, symbol: client.icon).centeredOnFirstLine(of: .body)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                Text(client.label).lineLimit(1)
                                if client.current {
                                    Text("· this device").font(.caption).foregroundStyle(MobileStyle.muted)
                                }
                            }
                            Text(client.detail()).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 8)
                    Button("Revoke", role: .destructive) { revoking = client }
                        .buttonStyle(.mobileCapsuleSmall)
                        .disabled(access.state.busy)
                }
                .padding(.vertical, 4)
            }
            if access.loaded && access.clients.isEmpty {
                Text("Nothing else has access to this machine.").foregroundStyle(MobileStyle.muted)
            }
            if let problem = access.state.problem {
                Text(problem).foregroundStyle(MobileStyle.statusError)
                Button("Try again") { Task { await access.load() } }
            }
        } header: {
            Text("Browsers and apps with access to this machine.")
        } footer: {
            Text("An app gets in by signing in to the account \(name) is on.")
        }
        .task { await access.load() }
        .alert(
            "Revoke \(revoking?.label ?? String(localized: "this device"))?",
            isPresented: $revoking.isPresent(),
            presenting: revoking
        ) { client in
            Button("Revoke", role: .destructive) { Task { await revoke(client) } }
            Button("Cancel", role: .cancel) {}
        } message: { client in
            Text(client.revokeMessage)
        }
    }

    private func revoke(_ client: MachineClientAccess) async {
        guard await access.revoke(client), client.current else { return }
        dismiss()
        runtime.forgetMachine(session.machine.id)
    }
}
