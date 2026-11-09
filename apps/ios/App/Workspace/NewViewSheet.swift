import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What New view made, for the project's page to take up once the sheet is gone.
enum NewViewResult: Equatable {
    case view(String)
    /// A view that asks for what it shows, its address, before it opens.
    case ask(JSONValue)
    case heading(JSONValue)
    case file
}

/// The views New view makes, as the desktop makes them: named after what they are until a session or a person names
/// them.
enum NewViewFactory {
    static func base(_ kind: String) -> String {
        switch kind {
        case "canvas": "Canvas"
        case "chat": "AI Chat"
        case "subheader": "Section"
        default: kind.capitalized
        }
    }

    static func freeName(_ views: [JSONValue], base: String) -> String {
        let taken = Set(views.compactMap { $0["name"]?.stringValue })
        guard taken.contains(base) else { return base }
        var counter = 2
        while taken.contains("\(base) \(counter)") { counter += 1 }
        return "\(base) \(counter)"
    }

    /// A new view of `kind`. A chat with `agent` runs that CLI and is named after it.
    static func view(kind: String, agent: (kind: String, name: String)? = nil, existing: [JSONValue] = []) -> JSONValue {
        var item: [String: JSONValue] = ["id": .string(kind + "-" + UUID().uuidString), "kind": .string(kind)]
        switch kind {
        case "separator": break
        case "chat":
            item["name"] = .string(agent?.name ?? freeName(existing, base: base(kind)))
            item["node"] = .object(
                agent.map { ["provider": .string($0.kind), "providerFixed": .bool(true)] } ?? [:])
        case "terminal":
            item["name"] = .string(freeName(existing, base: base(kind)))
            item["node"] = .object([:])
        case "canvas":
            item["name"] = .string(freeName(existing, base: base(kind)))
            for key in ["nodes", "texts", "edges", "layouts"] { item[key] = .array([]) }
        case "browser":
            item["name"] = .string(freeName(existing, base: base(kind)))
            item["url"] = .string("")
        default:
            item["name"] = .string(freeName(existing, base: base(kind)))
        }
        return .object(item)
    }

    static func result(for item: JSONValue) -> NewViewResult? {
        switch item.text("kind") {
        case "separator": nil
        case "subheader": .heading(item)
        case "browser": .ask(item)
        default: .view(item.stableID)
        }
    }
}

/// New view without a form: one tap makes the view and opens it. A browser asks for its address and a heading for
/// its words once they are made; a file view starts from a file picked in the project's files.
struct NewViewSheet: View {
    let workspace: MobileWorkspace
    let made: (NewViewResult) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var agents: [(kind: String, name: String)]?
    @State private var saving = false
    @State private var designing = false

    /// A design keeps its pages in the project folder, and a machine before designs would not know its folder.
    private var designOffered: Bool {
        !workspace.isScratch && (workspace.client as? MachineClient)?.answers(.artifactSaveFolder) == true
            && agents?.isEmpty == false
    }

    private var kinds: [String] { ProjectKinds.newView + (designOffered ? ["design"] : []) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    heading(String(localized: "Chat with"))
                    agentTiles
                    heading(String(localized: "View", comment: "Heading over the kinds of view to make"))
                        .padding(.top, 10)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(kinds, id: \.self) { kind in
                            Button {
                                switch kind {
                                case "file": pickFile()
                                case "design": designing = true
                                default: create(kind)
                                }
                            } label: {
                                VStack(spacing: 6) {
                                    LucideIcon(name: WorkspaceViewIcon.name(for: .object(["kind": .string(kind)])), size: 18)
                                    Text(ProjectKinds.label(kind)).font(.footnote)
                                }
                                .frame(maxWidth: .infinity, minHeight: 68)
                                .background(MobileStyle.hover, in: .rect(cornerRadius: 18))
                                .contentShape(.rect(cornerRadius: 18))
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("newView.\(kind)")
                        }
                    }
                    heading(String(localized: "Divide the list")).padding(.top, 10)
                    HStack(spacing: 8) {
                        capsule(String(localized: "Separator"), icon: "minus") { create("separator") }
                        capsule(String(localized: "Subheader"), icon: "heading") { create("subheader") }
                    }
                    if let problem = workspace.problem {
                        Text(problem).font(.footnote).foregroundStyle(MobileStyle.statusError).padding(.top, 8)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .disabled(saving || !workspace.ready)
            .navigationTitle("New view")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
            }
        }
        .confirmationDialog(String(localized: "Design with"), isPresented: $designing, titleVisibility: .visible) {
            ForEach(agents ?? [], id: \.kind) { agent in
                Button(agent.name) { createDesign(agent) }
            }
        }
        .presentationDetents([.medium, .large])
        .task(id: workspace.session.generation) {
            guard workspace.session.connected, let providers = try? await AgentCatalog.load(workspace.client) else {
                if agents == nil && !workspace.session.connected { agents = [] }
                return
            }
            agents = AgentCatalog.installedChats(providers).map { ($0.kind, $0.name) }
        }
    }

    @ViewBuilder private var agentTiles: some View {
        if let agents {
            if agents.isEmpty {
                Text("No chat agent is installed on \(workspace.session.machine.name).")
                    .font(.footnote).foregroundStyle(MobileStyle.muted).padding(.vertical, 8)
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(agents, id: \.kind) { agent in
                        Button {
                            create("chat", agent: agent)
                        } label: {
                            HStack(spacing: 10) {
                                LucideIcon(name: "message-square", size: 18).foregroundStyle(MobileStyle.muted)
                                Text(agent.name).font(.callout.weight(.medium)).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 14)
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .background(MobileStyle.active, in: .rect(cornerRadius: 18))
                            .contentShape(.rect(cornerRadius: 18))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("newView.chat.\(agent.kind)")
                    }
                }
            }
        } else {
            MobileLoadingRow(String(localized: "Finding the agents on this machine"))
                .frame(maxWidth: .infinity, minHeight: 56)
        }
    }

    private func heading(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(MobileStyle.muted).padding(.horizontal, 4)
            .padding(.vertical, 4)
    }

    private func capsule(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                LucideIcon(name: icon, size: 15)
                Text(title)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.mobileCapsule)
    }

    private func create(_ kind: String, agent: (kind: String, name: String)? = nil) {
        saving = true
        Task {
            defer { saving = false }
            let item = NewViewFactory.view(kind: kind, agent: agent, existing: workspace.views)
            await workspace.edit { $0.setting("views", .array($0.list("views") + [item])) }
            guard workspace.problem == nil else { return }
            if kind == "chat" { AppUsage.count(.chatStarted) }
            if let result = NewViewFactory.result(for: item) { made(result) }
            dismiss()
        }
    }

    /// A design named "Design" until that is taken, keeping its pages in a folder no other design has, on disk or in
    /// the project, so a new design never opens on another's files.
    private func createDesign(_ agent: (kind: String, name: String)) {
        saving = true
        Task {
            defer { saving = false }
            // Read before the document, since the list may change while the disk answers.
            var onDisk: [String] = []
            for folder in DesignFiles.folders {
                let listed = try? await workspace.client.request(
                    .fsList,
                    payload: .object([
                        "path": .string(workspace.folder + "/" + folder), "depth": .number(1), "hidden": .bool(true),
                    ])
                ).decoded(as: FsListResult.self)
                onDisk += (listed?.entries ?? []).filter { $0.kind == .directory }.map(\.name)
            }
            let name = DesignFiles.freeName(workspace.views)
            let item = DesignFiles.view(
                agent: agent.kind, name: name, path: DesignFiles.freeFolder(workspace.views, name: name, onDisk: onDisk))
            await workspace.edit { $0.setting("views", .array($0.list("views") + [item])) }
            guard workspace.problem == nil else { return }
            AppUsage.count(.chatStarted)
            made(.view(item.stableID))
            dismiss()
        }
    }

    private func pickFile() {
        made(.file)
        dismiss()
    }
}
