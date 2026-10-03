import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// A client with access to a machine, from `auth.sessions`.
struct MachineClientAccess: Identifiable, Equatable {
    let id: String
    let label: String
    /// `link` or `statement`; a daemon from before statements says nothing, and all of its clients came in on a link.
    let origin: String
    let createdAt: Date
    let lastSeenAt: Date
    let current: Bool

    init(_ value: JSONValue) {
        id = value.text("id")
        label = value.text("label", fallback: "Unnamed client")
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
        let how = origin == "statement" ? "Signed in through an account" : "Paired with a link"
        let since = createdAt.formatted(.dateTime.day().month())
        let seen = lastSeenAt.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
        return "\(how) \(since) · last seen \(seen)"
    }

    /// What revoking this one means, which differs per way in.
    var revokeMessage: String {
        if current {
            return "This is the client you are using. It loses access to this machine and forgets it here. Pair again to regain access."
        }
        if origin == "statement" {
            return "It loses access the next time it connects, and signing in through an account will not let it back in. Pairing again needs a link."
        }
        return "It loses access the next time it connects. Pairing again needs a new link."
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
            let result = try await client.request(WireRequest.authSessions.rawValue, payload: .object([:]))
            try stillTheLatest()
            clients = result.list("sessions").map(MachineClientAccess.init)
                .sorted { ($0.current ? 1 : 0, $0.lastSeenAt) > ($1.current ? 1 : 0, $1.lastSeenAt) }
            loaded = true
        }
    }

    /// Answers whether the machine took the revocation.
    func revoke(_ access: MachineClientAccess) async -> Bool {
        var revoked = false
        await state.perform {
            _ = try await client.request(WireRequest.authRevoke.rawValue, payload: .object(["id": .string(access.id)]))
            clients.removeAll { $0.id == access.id }
            revoked = true
        }
        return revoked
    }
}

/// The desktop's Apps with access: every client paired with the machine, how it came in and when it was there. Only
/// the app on the machine itself may make a pairing link, so this sheet says where to get one instead of showing it.
struct MachineAccessSheet: View {
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
        NavigationStack {
            MobileForm {
                Section {
                    if access.state.loading {
                        MobileLoadingRow("Loading clients").frame(maxWidth: .infinity)
                    }
                    ForEach(access.clients) { client in
                        HStack(spacing: 11) {
                            Image(lucide: client.icon, size: 17).foregroundStyle(MobileStyle.muted).frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    Text(client.label).lineLimit(1)
                                    if client.current {
                                        Text("· this client").font(.caption).foregroundStyle(MobileStyle.muted)
                                    }
                                }
                                Text(client.detail()).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(2)
                            }
                            Spacer(minLength: 8)
                            Button("Revoke", role: .destructive) { revoking = client }
                                .font(.subheadline)
                                .buttonStyle(.borderless)
                                .disabled(access.state.busy)
                        }
                        .padding(.vertical, 4)
                    }
                    if access.loaded && access.clients.isEmpty {
                        Text("Nothing else has access to this machine.").foregroundStyle(MobileStyle.muted)
                    }
                } header: {
                    Text("Browsers and apps paired with this machine.")
                } footer: {
                    Text(
                        "A pairing link comes from the machine itself: open Settings in Ruimte on \(name) and choose Show pairing link under Apps with access, or run ruimte pair there."
                    )
                }
                if let problem = access.state.problem {
                    Section {
                        Text(problem).foregroundStyle(.red)
                        Button("Try again") { Task { await access.load() } }
                    }
                }
            }
            .navigationTitle("Apps with access")
            .navigationSubtitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(role: .confirm) { dismiss() } }
            }
            .task { await access.load() }
            .alert(
                "Revoke \(revoking?.label ?? "this client")?",
                isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }),
                presenting: revoking
            ) { client in
                Button("Revoke", role: .destructive) { Task { await revoke(client) } }
                Button("Cancel", role: .cancel) {}
            } message: { client in
                Text(client.revokeMessage)
            }
        }
    }

    private func revoke(_ client: MachineClientAccess) async {
        guard await access.revoke(client), client.current else { return }
        dismiss()
        runtime.forgetMachine(session.machine.id)
    }
}
