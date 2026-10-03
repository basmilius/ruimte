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
    /// Named under the title on an iPhone, whose sheet stands over the project.
    private let projectName: String?

    init(client: any MachineRequesting, projectID: String, folder: String, projectName: String? = nil) {
        _store = State(initialValue: ProjectLaunches(client: client, projectID: projectID, folder: folder))
        self.projectName = projectName
    }

    var body: some View {
        MobileList {
            if let problem = store.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            content
        }
        .navigationTitle("Launches")
        .navigationSubtitle(projectName ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $output) { launchID in
            LaunchOutputPage(store: store, launchID: launchID)
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Button(String(localized: "New launch"), lucideIcon: "plus") { sheet = .edit(nil) }
                    Button(String(localized: "Find in this project…"), lucideIcon: "search") { sheet = .importing }
                    if store.anyLive {
                        Button(String(localized: "Stop all"), lucideIcon: "square", role: .destructive) { Task { await store.stopAll() } }
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
        .task(id: store.document?.launches.map(\.id)) {
            guard let launches = store.document?.launches else { return }
            found = await store.detect().map { LaunchEditing.newSuggestions($0, existing: launches) }
        }
        .mobileSheet(item: $sheet) { sheet in
            switch sheet {
            case .edit(let launchID): LaunchEditorSheet(store: store, launchID: launchID)
            case .importing: LaunchImportSheet(store: store)
            }
        }
        .modifier(LaunchAskModifier(store: store))
        .alert(
            "Delete \(deleting?.name ?? String(localized: "this launch"))?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            presenting: deleting
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
                String(localized: "Needs an update"), lucideIcon: "circle-alert", description: Text(LaunchesText.outdated))
        } else if let document = store.document {
            if document.launches.isEmpty {
                ContentUnavailableView {
                    Label(String(localized: "No launches in this project yet."), lucideIcon: "rocket", iconSize: 48)
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
                if let held = document.launches.first(where: { views[$0.id]?.phase == .held }) {
                    Text(
                        "\(held.name) comes from .ruimte/launches.json. Nothing from it runs on this machine until you approve it."
                    )
                    .font(.caption).foregroundStyle(MobileStyle.muted)
                }
                foundSection
            }
        } else {
            MobileLoadingRow(String(localized: "Reading the launches")).frame(maxWidth: .infinity).padding()
        }
    }

    /// What the machine finds in the project that is no launch yet, so the next ones need no typing.
    @ViewBuilder private var foundSection: some View {
        if let found, !LaunchEditing.foundRows(found).isEmpty {
            Section("Found in this project") {
                ForEach(LaunchEditing.foundRows(found), id: \.id) { row in
                    Button {
                        sheet = .importing
                    } label: {
                        HStack(spacing: 10) {
                            Image(lucide: "file-text", size: 15).foregroundStyle(MobileStyle.muted)
                            Text(row.text).foregroundStyle(MobileStyle.text)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text("Add").font(.footnote).foregroundStyle(MobileStyle.muted)
                        }
                    }
                }
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
                    LaunchStateDot(phase: view.phase)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 6) {
                            Text(launch.name).fontWeight(.medium).lineLimit(1)
                            Image(lucide: launch.shared ? "users" : "lock", size: 12).foregroundStyle(MobileStyle.faint)
                                .accessibilityLabel(launch.shared ? "Shared with the team" : "Only on this machine")
                        }
                        if let command = launch.command, !command.isEmpty {
                            Text(command).font(.caption.monospaced()).foregroundStyle(MobileStyle.muted)
                                .lineLimit(1).truncationMode(.tail)
                        }
                        TimelineView(.periodic(from: .now, by: 30)) { context in
                            Text(LaunchLogic.stateLine(view, now: context.date.timeIntervalSince1970 * 1000))
                                .font(.caption).monospacedDigit()
                                .foregroundStyle(LaunchStateDot.color(view.phase, text: true))
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                }
                .frame(minHeight: 54)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            LaunchButtons(store: store, view: view) { output = launch.id }
        }
        .contextMenu {
            LaunchMenuItems(store: store, view: view)
            Button(String(localized: "Show output"), lucideIcon: "square-terminal") { output = launch.id }
            Button(String(localized: "Edit…"), lucideIcon: "pencil") { sheet = .edit(launch.id) }
            Button(String(localized: "Delete…"), lucideIcon: "trash", role: .destructive) { deleting = launch }
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

/// A launch's state as a dot in its color: green while it runs, amber while it waits for an approval, red once it
/// failed.
struct LaunchStateDot: View {
    let phase: LaunchPhase

    var body: some View {
        Circle().fill(Self.color(phase, text: false)).frame(width: 8, height: 8)
            .frame(width: 18)
            .accessibilityElement()
            .accessibilityLabel(phase.label)
    }

    static func color(_ phase: LaunchPhase, text: Bool) -> Color {
        switch phase {
        case .running: MobileStyle.positive
        case .starting, .stopping: MobileStyle.statusRunning
        case .held: MobileStyle.statusNeedsYou
        case .failed: MobileStyle.statusError
        case .idle, .passed: text ? MobileStyle.muted : MobileStyle.faint
        }
    }
}

/// The output and Stop while it runs, Approve while it waits for a person, Force stop while it stops, else Launch:
/// the desktop's buttons on a launch. Restart is in the row's menu.
struct LaunchButtons: View {
    let store: ProjectLaunches
    let view: LaunchView
    /// Nil where the output is on screen already.
    var showOutput: (() -> Void)?

    var body: some View {
        HStack(spacing: 6) {
            let name = view.launch.name
            if view.phase == .stopping {
                button("octagon-x", label: String(localized: "Force stop \(name)")) { await store.stop(view.launch.id, force: true) }
            } else if view.live {
                if let showOutput {
                    Button(action: showOutput) {
                        Image(lucide: "terminal", size: 13).frame(width: 32, height: 32)
                            .background(MobileStyle.hover, in: .circle)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Output of \(name)")
                }
                button("square", label: String(localized: "Stop \(name)")) { await store.stop(view.launch.id) }
            } else if view.phase == .held {
                Button {
                    Task { await store.press(view.launch) }
                } label: {
                    Text("Approve").font(.footnote.weight(.semibold)).padding(.horizontal, 12).frame(height: 30)
                        .background(MobileStyle.text, in: .capsule).foregroundStyle(MobileStyle.surface)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Approve and launch \(name)")
            } else {
                button("play", label: String(localized: "Launch \(name)")) { await store.press(view.launch) }
            }
        }
        .foregroundStyle(MobileStyle.text)
        .disabled(!store.connected)
    }

    private func button(_ icon: String, label: String, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            Image(lucide: icon, size: 13).frame(width: 32, height: 32)
                .background(MobileStyle.hover, in: .circle)
        }
        .buttonStyle(.plain)
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
            Button(String(localized: "Force stop"), lucideIcon: "octagon-x", role: .destructive) {
                Task { await store.stop(id, force: true) }
            }
        } else if view.live {
            Button(String(localized: "Restart"), lucideIcon: "rotate-cw") { Task { await store.run(id, restart: true) } }
            Button(String(localized: "Stop"), lucideIcon: "square") { Task { await store.stop(id) } }
        } else {
            Button(String(localized: "Launch"), lucideIcon: "play") { Task { await store.press(view.launch) } }
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
            .alert(
                "Port \(busy?.port ?? 0) is in use",
                isPresented: Binding(
                    get: { busy != nil },
                    set: { if !$0, busy != nil { store.ask = nil } })
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
