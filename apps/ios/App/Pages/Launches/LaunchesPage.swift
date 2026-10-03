import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What the launches page opens on top of itself.
enum LaunchSheet: Identifiable, Equatable {
    /// The editor on a launch; nil is a new one.
    case edit(String?)
    case importing

    var id: String {
        switch self {
        case .edit(let launchID): "edit:\(launchID ?? "")"
        case .importing: "import"
        }
    }
}

/// The launches of a project with the state of each, as the desktop's chip and panel show them. A tap opens a
/// launch's output; the buttons start, restart and stop it, and Force stop is offered only while it is stopping.
struct LaunchesPage: View {
    @State private var store: ProjectLaunches
    @State private var sheet: LaunchSheet?
    @State private var output: String?
    @State private var deleting: LaunchEntry?
    @State private var found: [LaunchSuggestion]?

    init(client: any MachineRequesting, projectID: String, folder: String) {
        _store = State(initialValue: ProjectLaunches(client: client, projectID: projectID, folder: folder))
    }

    var body: some View {
        MobileList {
            if let problem = store.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            content
        }
        .navigationTitle("Launches")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $output) { launchID in
            LaunchOutputPage(store: store, launchID: launchID)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("New launch", lucideIcon: "plus") { sheet = .edit(nil) }
                    Button("Find in this project…", lucideIcon: "search") { sheet = .importing }
                    if store.anyLive {
                        Button("Stop all", lucideIcon: "square", role: .destructive) { Task { await store.stopAll() } }
                    }
                } label: {
                    Image(lucide: "plus")
                }
                .accessibilityLabel("Add launches")
                .disabled(store.document == nil || store.unsupported)
            }
        }
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .refreshable { await store.load() }
        .task(id: store.document?.launches.isEmpty) {
            guard store.document?.launches.isEmpty == true else { return }
            found = await store.detect().map { LaunchEditing.newSuggestions($0, existing: []) }
        }
        .mobileSheet(item: $sheet) { sheet in
            switch sheet {
            case .edit(let launchID): LaunchEditorSheet(store: store, launchID: launchID)
            case .importing: LaunchImportSheet(store: store)
            }
        }
        .modifier(LaunchAskModifier(store: store))
        .confirmationDialog(
            "Delete \(deleting?.name ?? "this launch")?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible, presenting: deleting
        ) { launch in
            Button("Delete launch", role: .destructive) { Task { await store.delete(launch.id) } }
            Button("Cancel", role: .cancel) {}
        } message: { launch in
            Text(
                launch.shared
                    ? "It goes from .ruimte/launches.json, for everyone who shares the project."
                    : "It goes from the launches only you have on this machine.")
        }
    }

    @ViewBuilder private var content: some View {
        if store.unsupported {
            ContentUnavailableView(
                "Needs an update", lucideIcon: "circle-alert", description: Text(LaunchesText.outdated))
        } else if let document = store.document {
            if document.launches.isEmpty {
                ContentUnavailableView {
                    Label("No launches in this project yet.", lucideIcon: "rocket", iconSize: 48)
                } actions: {
                    Button("New launch") { sheet = .edit(nil) }
                }
                foundSection
            } else {
                let views = store.views
                ForEach(store.sections) { section in
                    Section {
                        ForEach(section.launches) { launch in
                            if let view = views[launch.id] { row(view) }
                        }
                    } header: {
                        if let label = section.label { Text(label) }
                    }
                }
            }
        } else {
            MobileLoadingRow("Reading the launches").frame(maxWidth: .infinity).padding()
        }
    }

    /// A project without launches offers what the machine finds in it, so the first ones need no typing.
    @ViewBuilder private var foundSection: some View {
        if let found, let text = LaunchEditing.foundText(found) {
            Section("Found in this project") {
                Text(text).font(.caption).foregroundStyle(MobileStyle.muted)
                Button("Review and import…", lucideIcon: "search") { sheet = .importing }
            }
        }
    }

    private func row(_ view: LaunchView) -> some View {
        let launch = view.launch
        return HStack(spacing: 10) {
            Button {
                output = launch.id
            } label: {
                HStack(spacing: 10) {
                    LaunchStatusIcon(phase: view.phase)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(launch.name).lineLimit(1)
                            Image(lucide: launch.shared ? "users" : "lock", size: 12).foregroundStyle(MobileStyle.faint)
                                .accessibilityLabel(launch.shared ? "Shared with the team" : "Only on this machine")
                        }
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let detail = LaunchLogic.detail(view, now: context.date.timeIntervalSince1970 * 1000)
                            if !detail.isEmpty {
                                Text(detail).font(.caption).monospacedDigit()
                                    .foregroundStyle(view.phase == .failed ? MobileStyle.statusError : MobileStyle.muted)
                                    .lineLimit(1)
                            }
                        }
                    }
                    Spacer(minLength: 8)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            LaunchButtons(store: store, view: view)
        }
        .contextMenu {
            LaunchMenuItems(store: store, view: view)
            Button("Show output", lucideIcon: "square-terminal") { output = launch.id }
            Button("Edit…", lucideIcon: "pencil") { sheet = .edit(launch.id) }
            Button("Delete…", lucideIcon: "trash-2", role: .destructive) { deleting = launch }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("Delete", role: .destructive) { deleting = launch }
            Button("Edit") { sheet = .edit(launch.id) }.tint(MobileStyle.accent)
        }
    }
}

/// The phase of a launch as an icon in the color of its state, with a spinner while it starts or stops.
struct LaunchStatusIcon: View {
    let phase: LaunchPhase

    var body: some View {
        Group {
            switch phase {
            case .starting, .stopping:
                Spinner(size: 14).foregroundStyle(MobileStyle.statusRunning)
            case .idle: Image(lucide: "circle", size: 15).foregroundStyle(MobileStyle.faint)
            case .held: Image(lucide: "circle-alert", size: 15).foregroundStyle(MobileStyle.faint)
            case .running: Image(lucide: "circle-dot", size: 15).foregroundStyle(MobileStyle.positive)
            case .passed: Image(lucide: "circle-check", size: 15).foregroundStyle(MobileStyle.positive)
            case .failed: Image(lucide: "circle-x", size: 15).foregroundStyle(MobileStyle.statusError)
            }
        }
        .frame(width: 18)
        .accessibilityElement()
        .accessibilityLabel(phase.label)
    }
}

/// Launch, or Restart and Stop while it runs, or Force stop while it stops: the desktop's buttons on a launch.
struct LaunchButtons: View {
    let store: ProjectLaunches
    let view: LaunchView

    var body: some View {
        HStack(spacing: 2) {
            let name = view.launch.name
            if view.phase == .stopping {
                button("octagon-x", label: "Force stop \(name)") { await store.stop(view.launch.id, force: true) }
            } else if view.live {
                button("rotate-cw", label: "Restart \(name)") { await store.run(view.launch.id, restart: true) }
                button("square", label: "Stop \(name)") { await store.stop(view.launch.id) }
            } else {
                button("play", label: "Launch \(name)") { await store.press(view.launch) }
            }
        }
        .disabled(!store.connected)
    }

    private func button(_ icon: String, label: String, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            Image(lucide: icon, size: 16).frame(width: 40, height: 40)
        }
        .buttonStyle(.plain)
        .foregroundStyle(MobileStyle.text)
        .accessibilityLabel(label)
    }
}

/// The same buttons as menu items, for a long-press and the output page.
struct LaunchMenuItems: View {
    let store: ProjectLaunches
    let view: LaunchView

    var body: some View {
        let id = view.launch.id
        if view.phase == .stopping {
            Button("Force stop", lucideIcon: "octagon-x", role: .destructive) {
                Task { await store.stop(id, force: true) }
            }
        } else if view.live {
            Button("Restart", lucideIcon: "rotate-cw") { Task { await store.run(id, restart: true) } }
            Button("Stop", lucideIcon: "square") { Task { await store.stop(id) } }
        } else {
            Button("Launch", lucideIcon: "play") { Task { await store.press(view.launch) } }
        }
    }
}

/// The questions a start can come back with: approving a command from the project file, or stopping the launch that
/// holds the port.
struct LaunchAskModifier: ViewModifier {
    @Bindable var store: ProjectLaunches

    private var busy: (launchID: String, restart: Bool, holder: String, port: Int, approve: Bool)? {
        if case .busy(let launchID, let restart, let holder, let port, let approve) = store.ask {
            return (launchID, restart, holder, port, approve)
        }
        return nil
    }

    func body(content: Content) -> some View {
        content
            .mobileSheet(
                isPresented: Binding(
                    get: { if case .held = store.ask { true } else { false } },
                    set: { if !$0, case .held = store.ask { store.ask = nil } })
            ) {
                if case .held(let launchID, let restart, let held, let replace) = store.ask {
                    LaunchApprovalSheet(held: held) {
                        store.ask = nil
                        Task { await store.run(launchID, restart: restart, approve: true, replace: replace) }
                    } onCancel: {
                        store.ask = nil
                    }
                }
            }
            .confirmationDialog(
                "Port \(busy?.port ?? 0) is in use",
                isPresented: Binding(
                    get: { busy != nil },
                    set: { if !$0, busy != nil { store.ask = nil } }),
                titleVisibility: .visible
            ) {
                if let busy {
                    Button("Stop and launch", role: .destructive) {
                        store.ask = nil
                        Task {
                            await store.run(busy.launchID, restart: busy.restart, approve: busy.approve, replace: true)
                        }
                    }
                }
                Button("Cancel", role: .cancel) { store.ask = nil }
            } message: {
                if let busy {
                    Text(
                        "\(store.name(busy.holder)) uses port \(busy.port). Stop it and launch \(store.name(busy.launchID))?")
                }
            }
    }
}

/// What a launch would run here, whole: every variable, the folder and the command, since the approval covers all
/// three and a change to any of them asks again.
struct LaunchApprovalSheet: View {
    let held: [LaunchHeld]
    let onApprove: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            MobileList {
                Text(
                    "This launch comes from .ruimte/launches.json. Nothing from it runs on this machine until you approve it here."
                )
                .foregroundStyle(MobileStyle.muted)
                ForEach(held) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(entry.env.sorted { $0.key < $1.key }, id: \.key) { variable in
                            Text("\(Text("\(variable.key)=").foregroundStyle(MobileStyle.faint))\(variable.value)")
                        }
                        Text("\(Text("\(entry.cwd) $ ").foregroundStyle(MobileStyle.faint))\(entry.command)")
                    }
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .navigationTitle("Run a command from the project file?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) { Button("Launch", action: onApprove) }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
