import RuimtePulsar
import SwiftUI

struct MachineDetailsPage: View {
    let session: SharedMachineSession
    @State private var state = RemotePageState()
    @State private var clients: [JSONValue] = []
    @State private var name = ""
    @State private var dirty = false
    @State private var revoke: JSONValue?
    var body: some View {
        MobileForm {
            RemotePageStatus(state: state) { Task { await load() } }
            if let endpoint = state.value {
                Section("Identity") {
                    TextField("Machine name", text: $name).onChange(of: name) { dirty = true }
                    Button("Save name") { Task { await rename() } }.disabled(
                        !dirty || state.busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    LabeledContent("Platform", value: endpoint.text("platform"))
                    LabeledContent("Version", value: endpoint.text("version"))
                    LabeledContent("Connection", value: session.relayed == true ? "Via relay" : "Direct")
                }
                Section("Paired clients") {
                    ForEach(clients, id: \.stableID) { client in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(client.text("label"))
                                if client["current"] == .bool(true) {
                                    Text("This device").font(.caption).foregroundStyle(MobileStyle.muted)
                                }
                                Text(
                                    "Last seen \(Date(timeIntervalSince1970: client.number("lastSeenAt") / 1000), style: .relative)"
                                ).font(.caption).foregroundStyle(MobileStyle.muted)
                            }
                            Spacer()
                            Button("Revoke", role: .destructive) { revoke = client }.disabled(state.busy)
                        }
                    }
                    if clients.isEmpty { Text("No paired clients.").foregroundStyle(MobileStyle.muted) }
                }
            }
        }
        .navigationTitle("Machine settings")
        .task {
            await RemotePageLifecycle.run(client: session.rpc, events: ["endpoint.changed"], load: load)
        }
        .confirmationDialog(
            "Revoke access for \(revoke?.text("label") ?? "this client")?",
            isPresented: Binding(get: { revoke != nil }, set: { if !$0 { revoke = nil } }), titleVisibility: .visible
        ) {
            Button("Revoke access", role: .destructive) { if let target = revoke { Task { await remove(target) } } }
            Button("Cancel", role: .cancel) { revoke = nil }
        } message: {
            Text("This client will need to pair again before it can reconnect.")
        }
    }
    private func load() async {
        await state.load {
            let endpoint = try await session.rpc.request("endpoint.info")
            clients = try await session.rpc.request("auth.sessions").list("sessions")
            if !dirty { name = endpoint.text("label") }
            return endpoint
        }
    }
    private func rename() async {
        await state.perform {
            state.value = try await session.rpc.request(
                "endpoint.setIdentity",
                payload: .object([
                    "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
                    "icon": state.value?["icon"] ?? .null,
                ]))
            dirty = false
        }
    }
    private func remove(_ target: JSONValue) async {
        await state.perform {
            _ = try await session.rpc.request("auth.revoke", payload: .object(["id": .string(target.stableID)]))
            clients.removeAll { $0.stableID == target.stableID }
            revoke = nil
        }
    }
}
