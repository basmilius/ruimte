import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The device view of a project that shows a device, or the one to add for it.
enum DeviceViews {
    /// The view of `views` that already shows the device, by the reference a project file keeps.
    static func existing(in views: [JSONValue], device: MachineDevice) -> String? {
        views.first { $0.text("kind") == "device" && $0["device"] == device.reference }?.stableID
    }

    static func view(for device: MachineDevice, id: String = "device-\(UUID().uuidString)") -> JSONValue {
        .object([
            "id": .string(id), "kind": .string("device"), "name": .string(device.name),
            "device": device.reference,
        ])
    }
}

/// The simulators, emulators and phones of a machine, grouped as the desktop's devices panel groups them. A running
/// one shows a read-only preview; Open as view puts it in a project, which is where it is driven.
struct MachineDevicesPage: View {
    let session: SharedMachineSession
    let devices: MachineDevices
    let projects: MachineProjectList
    @State private var opening: String?
    @State private var problem: String?
    @Environment(\.openMobileWorkspace) private var openWorkspace
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        Group {
            if wide && devices.loaded && !devices.devices.isEmpty && session.connected && session.endpoint.streamingAllowed
                && !devices.streamingOff
            {
                grid
            } else {
                MobileForm {
                    content
                    if let problem = problem ?? devices.problem {
                        Section { Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red).font(.callout) }
                    }
                }
            }
        }
        .navigationTitle("Devices")
        .navigationSubtitle(session.endpoint.label ?? session.machine.name)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await devices.load() }
                } label: {
                    Image(lucide: "refresh-cw").accessibilityLabel("Refresh devices")
                }
                .disabled(devices.loading || !session.connected)
            }
        }
        .task(id: session.connected) {
            if session.connected && session.endpoint.streamingAllowed { await devices.watch() }
        }
        .refreshable { await devices.load() }
    }

    /// An iPad has the room for the devices as a grid, each running one with its live picture.
    private var wide: Bool { UIDevice.current.userInterfaceIdiom == .pad && sizeClass == .regular }

    private var grid: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let problem = problem ?? devices.problem {
                    Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red).font(.callout)
                }
                ForEach(devices.groups) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(group.title).font(.footnote.weight(.semibold)).foregroundStyle(MobileStyle.muted)
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 260), spacing: 12, alignment: .top)], spacing: 12
                        ) {
                            ForEach(group.devices) { device in
                                Group {
                                    if device.booted && device.canStream {
                                        RunningDeviceCard(
                                            client: session.rpc, device: device,
                                            busy: devices.changing[device.id] != nil, opening: opening == device.id,
                                            projects: projects.listed,
                                            open: { project in Task { await open(device, in: project) } },
                                            shutdown: { Task { await devices.shutdown(device) } })
                                    } else {
                                        row(device)
                                    }
                                }
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(MobileStyle.panel, in: .rect(cornerRadius: 18))
                                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(MobileStyle.border))
                            }
                        }
                    }
                }
                if !devices.notes.isEmpty {
                    Text(devices.notes.joined(separator: "\n")).font(.footnote).foregroundStyle(MobileStyle.muted)
                }
            }
            .padding(20)
        }
        .background(MobileStyle.canvas)
    }

    @ViewBuilder private var content: some View {
        if !session.endpoint.streamingAllowed || devices.streamingOff {
            ContentUnavailableView(
                String(localized: "Streaming is off"), lucideIcon: "circle-alert",
                description: Text("Browser and device streaming is disabled in this machine's settings."))
        } else if !session.connected {
            ContentUnavailableView(String(localized: "The machine is not answering"), lucideIcon: "circle-alert")
        } else if !devices.loaded {
            MobileLoadingRow(String(localized: "Finding devices")).frame(maxWidth: .infinity).padding()
        } else if devices.devices.isEmpty {
            ContentUnavailableView(
                String(localized: "No devices"), lucideIcon: "smartphone",
                description: Text(([String(localized: "No devices were found on this machine.")] + devices.notes).joined(separator: "\n")))
        } else {
            ForEach(devices.groups) { group in
                Section {
                    ForEach(group.devices) { device in
                        if device.booted && device.canStream {
                            RunningDeviceCard(
                                client: session.rpc, device: device, busy: devices.changing[device.id] != nil,
                                opening: opening == device.id, projects: projects.listed,
                                open: { project in Task { await open(device, in: project) } },
                                shutdown: { Task { await devices.shutdown(device) } })
                        } else {
                            row(device)
                        }
                    }
                } header: {
                    Text(group.title)
                } footer: {
                    if group.id == devices.groups.last?.id && !devices.notes.isEmpty {
                        Text(devices.notes.joined(separator: "\n"))
                    }
                }
            }
        }
    }

    private func row(_ device: MachineDevice) -> some View {
        HStack(spacing: 10) {
            Image(lucide: "smartphone", size: 15)
                .frame(width: 30, height: 30)
                .background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(device.name).lineLimit(1)
                Text(device.displayRuntime.isEmpty ? device.stateText : "\(device.displayRuntime) · \(device.stateText)")
                    .font(.caption).foregroundStyle(device.waitsOnPerson ? MobileStyle.statusNeedsYou : MobileStyle.muted)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            if devices.changing[device.id] != nil || device.state == "transitioning" {
                ProgressView().accessibilityLabel("Changing state")
            } else if device.state == "shutdown" && device.canBoot {
                Button {
                    Task { await devices.boot(device) }
                } label: {
                    Label(String(localized: "Start"), lucideIcon: "play").font(.footnote.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
            } else if device.waitsOnPerson {
                Button("Retry") { Task { await devices.load() } }
                    .font(.footnote.weight(.semibold))
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
            }
        }
        .padding(.vertical, 2)
        .contextMenu { menu(device) }
    }

    @ViewBuilder private func menu(_ device: MachineDevice) -> some View {
        Menu("Open as view") {
            ForEach(projects.listed, id: \.stableID) { project in
                Button(project.text("name", fallback: String(localized: "Untitled project"))) {
                    Task { await open(device, in: project) }
                }
            }
        }
        .disabled(projects.listed.isEmpty)
        if device.state == "shutdown" && device.canBoot {
            Button(String(localized: "Start"), lucideIcon: "power") { Task { await devices.boot(device) } }
        }
        if device.booted && device.canShutdown {
            Button(String(localized: "Shut down"), lucideIcon: "power-off") { Task { await devices.shutdown(device) } }
        }
    }

    /// Puts the device in a project as a view, or finds the one it has, and opens it there.
    private func open(_ device: MachineDevice, in project: JSONValue) async {
        opening = device.id
        defer { opening = nil }
        let workspace = MobileWorkspace(
            session: session, projectID: project.text("projectId"), summary: project)
        workspace.start()
        await workspace.open()
        guard workspace.ready else {
            problem = workspace.problem ?? String(localized: "The project could not be opened.")
            workspace.stop()
            return
        }
        var id = DeviceViews.existing(in: workspace.views, device: device)
        if id == nil {
            let view = DeviceViews.view(for: device)
            await workspace.edit { $0.setting("views", .array($0.list("views") + [view])) }
            id = view.stableID
        }
        if let failure = workspace.problem {
            problem = failure
            workspace.stop()
            return
        }
        problem = nil
        openWorkspace(workspace, view: id)
    }
}

/// A device that runs: its picture, read-only, beside its name, Open as view and Shut down.
private struct RunningDeviceCard: View {
    let device: MachineDevice
    let busy: Bool
    let opening: Bool
    let projects: [JSONValue]
    let open: (JSONValue) -> Void
    let shutdown: () -> Void
    @State private var preview: MachineDevicePreview

    init(
        client: any MachineRequesting, device: MachineDevice, busy: Bool, opening: Bool, projects: [JSONValue],
        open: @escaping (JSONValue) -> Void, shutdown: @escaping () -> Void
    ) {
        self.device = device
        self.busy = busy
        self.opening = opening
        self.projects = projects
        self.open = open
        self.shutdown = shutdown
        _preview = State(initialValue: MachineDevicePreview(client: client, device: device))
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            screen
            VStack(alignment: .leading, spacing: 6) {
                Text(device.name).font(.callout.weight(.semibold)).lineLimit(2)
                MobileStatus(
                    title: device.displayRuntime.isEmpty ? device.stateText : "\(device.stateText) · \(device.displayRuntime)",
                    color: MobileStyle.positive)
                Text(preview.unavailable ?? String(localized: "Read-only preview. Open it as a view in a project to use it."))
                    .font(.caption).foregroundStyle(MobileStyle.muted)
                HStack(spacing: 6) {
                    Menu {
                        ForEach(projects, id: \.stableID) { project in
                            Button(project.text("name", fallback: String(localized: "Untitled project"))) { open(project) }
                        }
                    } label: {
                        if opening {
                            ProgressView()
                        } else {
                            Text("Open as view").font(.footnote.weight(.semibold))
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .tint(MobileStyle.text)
                    .foregroundStyle(MobileStyle.canvas)
                    .disabled(projects.isEmpty || opening)
                    if device.canShutdown {
                        Button(action: shutdown) {
                            if busy {
                                ProgressView()
                            } else {
                                Image(lucide: "square", size: 11).accessibilityLabel("Shut down")
                            }
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.circle)
                        .disabled(busy)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
        .task {
            await preview.start()
        }
        .onDisappear { preview.stop() }
    }

    private var screen: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color.black)
            .frame(width: 86, height: 176)
            .overlay {
                if let image = preview.image {
                    Image(uiImage: image).resizable().scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                        .padding(4)
                } else {
                    Image(lucide: "smartphone", size: 22).foregroundStyle(MobileStyle.faint)
                }
            }
            .accessibilityLabel("Preview of \(device.name)")
    }
}
