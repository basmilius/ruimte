import RuimtePulsar
import RuimteTransport
import SwiftUI

/// A machine: how it is reached and on which version, the update of its app, its projects, files, devices, processes
/// and usage, and what belongs to the machine itself, such as keep awake. Every row stands from the first frame of the
/// push, so the page never swaps what it shows once the machine answers.
struct MachinePage: View {
    @Bindable var session: SharedMachineSession
    let runtime: AppRuntime
    var settingsLink: SettingsLink?
    @State private var lease: MachineNavigationLease?
    @State private var projects: MachineProjectList
    @State private var devices: MachineDevices
    @State private var destination: Destination?
    @State private var openingFolder = false
    @State private var naming = false
    @State private var access = false
    @State private var confirming: MachineWork?

    private enum Destination: Hashable { case projects, files, devices, processes, usage, agents }

    init(session: SharedMachineSession, runtime: AppRuntime, settingsLink: SettingsLink? = nil) {
        self.session = session
        self.runtime = runtime
        self.settingsLink = settingsLink
        _projects = State(initialValue: MachineProjectList(session: session))
        let endpoint = session.endpoint
        _devices = State(
            initialValue: MachineDevices(client: session.rpc) { endpoint.info?["platform"]?.stringValue })
    }

    private var endpoint: MachineEndpoint { session.endpoint }
    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    private var name: String { endpoint.label ?? session.machine.name }

    var body: some View {
        MobileForm {
            Section {
                header
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
            if let update = endpoint.update, update.headline != nil || endpoint.install == .started {
                Section {
                    MachineUpdateBanner(update: update, install: endpoint.install) {
                        Task { await endpoint.askToInstall() }
                    }
                }
                .listRowBackground(MobileStyle.statusRunning.opacity(0.1))
            }
            if let problem = endpoint.problem ?? session.problem {
                Section {
                    Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red).font(.callout)
                    if !session.connected { Button("Reconnect") { session.reconnect() } }
                }
            }
            Section {
                row(String(localized: "Projects"), icon: "folders", value: projects.listed.isEmpty ? nil : "\(projects.listed.count)") {
                    destination = .projects
                }
                row(String(localized: "Files"), icon: "folder") { destination = .files }
                    .disabled(!session.connected)
                row(String(localized: "Devices"), icon: "smartphone", value: devicesValue, highlighted: devices.runningCount > 0) {
                    destination = .devices
                }
                row(String(localized: "Processes"), icon: "activity") { destination = .processes }
                usageRow
            }
            Section("On this machine") {
                keepAwakeRows
                LabeledContent("Connection", value: connectionValue)
                lanDoorRow
                row(String(localized: "Agents"), icon: "bot") { destination = .agents }
            }
        }
        .navigationTitle(name)
        .navigationDestination(item: $destination) { destination in
            switch destination {
            case .projects: MachineProjectsPage(session: session, list: projects)
            case .files: MachineFilesPage(client: session.rpc, path: "~")
            case .devices: MachineDevicesPage(session: session, devices: devices, projects: projects)
            case .processes: ProcessesPage(client: session.rpc)
            case .usage: MachineUsagePage(client: session.rpc, machineName: name, machines: usageMachines)
            case .agents: MachineAgentsPage(session: session)
            }
        }
        .toolbar {
            ToolbarItem(id: "machine.openFolder", placement: .topBarTrailing) {
                Button(String(localized: "Open folder"), lucideIcon: "folder-open") { openingFolder = true }.disabled(!session.connected)
            }
            ToolbarItem(id: "machine.menu", placement: .topBarTrailing) {
                Menu {
                    if isPad {
                        Button(String(localized: "Machine settings"), lucideIcon: "pencil") { naming = true }
                    } else {
                        Button(String(localized: "Name and icon"), lucideIcon: "pencil") { naming = true }
                        Button(String(localized: "Apps with access"), lucideIcon: "key-round") { access = true }
                    }
                    Divider()
                    Button(String(localized: "Reconnect"), lucideIcon: "refresh-cw") { session.reconnect() }
                } label: {
                    Image(lucide: "ellipsis").accessibilityLabel("Machine")
                }
                .disabled(!session.connected)
            }
            if let settingsLink {
                SettingsToolbarItem(link: settingsLink)
            }
        }
        .task {
            if lease == nil { lease = MachineNavigationLease(session) }
            projects.follow()
        }
        .task(id: session.generation) {
            guard session.connected else { return }
            await projects.load()
            if endpoint.streamingAllowed { await devices.load() }
        }
        .task(id: session.connected) {
            if session.connected { await endpoint.followLatency() }
        }
        .onDisappear { projects.unfollow() }
        .refreshable {
            await endpoint.refresh()
            await projects.load()
        }
        .onChange(of: endpoint.install) { _, step in
            if case .confirming(let work) = step { confirming = work }
        }
        .alert(
            "Restart Ruimte on \(name)?",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            presenting: confirming
        ) { _ in
            Button("Restart", role: .destructive) { Task { await endpoint.confirmInstall() } }
            Button("Cancel", role: .cancel) { endpoint.cancelInstall() }
        } message: { work in
            Text(MachineUpdate.restartQuestion(update: endpoint.update, work: work, machine: name))
        }
        .mobileSheet(isPresented: $openingFolder) { OpenFolderSheet(session: session) }
        .mobileSheet(isPresented: $naming) {
            MachineIdentitySheet(
                endpoint: endpoint, fallbackName: name, access: isPad ? (session: session, runtime: runtime) : nil)
        }
        .mobileSheet(isPresented: $access) { MachineAccessSheet(session: session, runtime: runtime, name: name) }
    }

    private var header: some View {
        HStack(spacing: 12) {
            LucideIcon(name: session.icons.icon?.value ?? "server", size: 22)
                .frame(width: 44, height: 44)
                .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                MobileStatus(title: reach, color: session.connected ? MobileStyle.positive : MobileStyle.faint)
                if let version = endpoint.version {
                    Text("Ruimte \(version)").font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var reach: String {
        MachineReach.line(
            connected: session.connected, connecting: session.failedAttempts == 0 && session.problem == nil,
            route: session.route, latency: endpoint.latency, problem: session.problem, lastSeen: session.lastSeen)
    }

    private var connectionValue: String {
        guard session.connected else { return String(localized: "Not connected") }
        return session.route?.label ?? String(localized: "Connected")
    }

    @ViewBuilder private var lanDoorRow: some View {
        if let open = endpoint.lanDoor {
            Toggle(
                isOn: Binding(get: { open }, set: { value in Task { await endpoint.setLanDoor(value) } })
            ) {
                Text("Reachable on the local network")
                Text(
                    endpoint.lanDoorFixed
                        ? String(localized: "A flag this machine started with decides this.")
                        : String(localized: "Devices on the same network connect directly, without the broker."))
            }
            .disabled(endpoint.lanDoorFixed || endpoint.savingLanDoor || !session.connected)
        }
    }

    private var devicesValue: String? {
        if !endpoint.streamingAllowed || devices.streamingOff { return String(localized: "Streaming off") }
        return devices.runningCount > 0 ? String(localized: "\(devices.runningCount) running", comment: "Devices running") : nil
    }

    private var usageMachines: [UsageMachine] {
        runtime.machines.map { machine in
            let session = runtime.session(for: machine)
            return UsageMachine(id: machine.id, name: session.endpoint.label ?? machine.name, client: session.rpc)
        }
    }

    private var usageRow: some View {
        Button {
            destination = .usage
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                MachineLinkLabel(title: String(localized: "Usage"), icon: "chart-no-axes-column")
                MachineLimitList(limits: .card(session.usageWidget))
            }
        }
        .foregroundStyle(MobileStyle.text)
    }

    @ViewBuilder private var keepAwakeRows: some View {
        if let keepAwake = endpoint.keepAwake {
            Picker(
                "Keep awake",
                selection: Binding(get: { keepAwake.mode }, set: { mode in changeKeepAwake { $0.mode = mode } })
            ) {
                ForEach(KeepAwakeMode.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.menu)
            .disabled(endpoint.savingKeepAwake)
            if keepAwake.mode != .off {
                Toggle(
                    "Also on battery",
                    isOn: Binding(get: { keepAwake.onBattery }, set: { value in changeKeepAwake { $0.onBattery = value } }))
                .disabled(endpoint.savingKeepAwake)
                if let closedLid = endpoint.closedLid {
                    closedLidRow(keepAwake, closedLid)
                }
            }
            if keepAwake.mode == .always {
                Toggle(
                    "Keep the display on",
                    isOn: Binding(
                        get: { keepAwake.displayApplies && keepAwake.display },
                        set: { value in changeKeepAwake { $0.display = value } }))
                .disabled(endpoint.savingKeepAwake || !keepAwake.onBattery)
            }
        }
    }

    /// The rule behind it can only be installed on the Mac itself, so until then the switch says where.
    private func closedLidRow(_ keepAwake: MachineKeepAwake, _ closedLid: MachineClosedLid) -> some View {
        Toggle(
            isOn: Binding(
                get: { closedLid.ruleInstalled && keepAwake.lidClosed },
                set: { value in changeKeepAwake { $0.lidClosed = value } })
        ) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Also with the lid closed")
                Group {
                    if closedLid.ruleInstalled {
                        Text("Sleep stays off while keep awake holds, so the Mac keeps running with its lid shut.")
                    } else {
                        Text("Allow it once in Ruimte on the Mac, under Settings, Agents.")
                    }
                }
                .font(.caption).foregroundStyle(MobileStyle.muted)
            }
        }
        .disabled(endpoint.savingKeepAwake || !closedLid.ruleInstalled)
    }

    /// Changes one part of keep awake and sends the rest as the machine has it now.
    private func changeKeepAwake(_ change: (inout MachineKeepAwake) -> Void) {
        guard var next = endpoint.keepAwake else { return }
        change(&next)
        Task { await endpoint.setKeepAwake(next) }
    }

    private func row(
        _ title: String, icon: String, value: String? = nil, highlighted: Bool = false, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            MachineLinkLabel(title: title, icon: icon, value: value, highlighted: highlighted)
        }
        .foregroundStyle(MobileStyle.text)
    }
}

/// A row that opens a page of the machine: its mark, its name, a value and the chevron.
struct MachineLinkLabel: View {
    let title: String
    let icon: String
    var value: String?
    var highlighted = false

    var body: some View {
        HStack(spacing: 11) {
            Image(lucide: icon, size: 17).foregroundStyle(MobileStyle.muted).frame(width: 22)
            Text(title)
            Spacer(minLength: 8)
            if let value {
                Text(value).font(.subheadline)
                    .foregroundStyle(highlighted ? MobileStyle.positive : MobileStyle.muted)
            }
            Image(lucide: "chevron-right", size: 12).foregroundStyle(MobileStyle.faint).accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The limits of a machine, an account to a row, and a line when the machine could not say which accounts it has.
struct MachineLimitList: View {
    let limits: MachineLimits

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(limits.lines) { MachineLimitRow(line: $0) }
            if limits.accountsUnavailable {
                Text(
                    "Account status unavailable",
                    comment: "Under a machine's limits when it could not list its accounts"
                )
                .font(.caption).foregroundStyle(MobileStyle.faint)
            }
        }
    }
}

/// One account: its CLI's mark, its dot when the CLI has more than one, its name, and its five hour window above its
/// week, each with what it used and amber once it comes close. At the largest text sizes the bars go under the name.
struct MachineLimitRow: View {
    let line: MachineLimitLine
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .caption) private var nameWidth: CGFloat = 104
    @ScaledMetric(relativeTo: .caption) private var markSize: CGFloat = 12
    @ScaledMetric(relativeTo: .caption2) private var percentWidth: CGFloat = 34

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 6) {
                    name
                    value
                }
            } else {
                HStack(spacing: 10) {
                    name.frame(width: nameWidth, alignment: .leading)
                    value
                }
            }
        }
        .font(.caption)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenName)
        .accessibilityValue(spokenValue)
    }

    private var name: some View {
        HStack(spacing: 6) {
            ChatProviderMark(provider: line.kind, size: markSize).foregroundStyle(MobileStyle.muted)
            if line.named { AccountDot(color: line.color, size: 7) }
            Text(line.name).lineLimit(1).truncationMode(.tail)
        }
    }

    @ViewBuilder private var value: some View {
        switch line.content {
        case .bars(let session, let week):
            HStack(spacing: 8) {
                VStack(spacing: 4) {
                    bar(session, color: MobileStyle.text)
                    bar(week, color: MobileStyle.muted)
                }
                VStack(alignment: .trailing, spacing: 0) {
                    percent(session, color: MobileStyle.text)
                    percent(week, color: MobileStyle.muted)
                }
                .frame(width: percentWidth, alignment: .trailing)
            }
        case .status(let status):
            Text(status).foregroundStyle(MobileStyle.faint).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private func bar(_ bar: MachineLimitLine.Bar?, color: Color) -> some View {
        if let bar {
            ShareBar(fraction: bar.used, color: bar.used >= 0.8 ? MobileStyle.statusNeedsYou : color, height: 4)
        } else {
            Color.clear.frame(height: 4)
        }
    }

    private func percent(_ bar: MachineLimitLine.Bar?, color: Color) -> some View {
        let close = (bar?.used ?? 0) >= 0.8
        return Text(
            bar.map { Format.percent(($0.used * 100).rounded()) }
                ?? String(localized: "n/a", comment: "In place of a limit window the CLI does not have")
        )
        .font(.caption2)
        .monospacedDigit()
        .foregroundStyle(bar == nil ? MobileStyle.faint : close ? MobileStyle.statusNeedsYou : color)
        .lineLimit(1)
    }

    private var spokenName: String {
        let provider = usageProviderName(line.kind)
        return line.name == provider ? provider : "\(provider), \(line.name)"
    }

    private var spokenValue: String {
        switch line.content {
        case .status(let status):
            return status
        case .bars(let session, let week):
            let used = { (bar: MachineLimitLine.Bar) in Format.percent((bar.used * 100).rounded()) }
            switch (session, week) {
            case (let session?, let week?):
                return String(
                    localized: "5 hours \(used(session)) used, week \(used(week)) used",
                    comment: "A CLI account's two limit windows as VoiceOver reads them")
            case (let session?, nil):
                return String(localized: "5 hours \(used(session)) used", comment: "A CLI account's session window")
            case (nil, let week?):
                return String(localized: "Week \(used(week)) used", comment: "A CLI account's weekly window")
            case (nil, nil):
                return ""
            }
        }
    }
}

/// Says once, above the machines, which bar is which.
struct MachineLimitLegend: View {
    var body: some View {
        HStack(spacing: 8) {
            VStack(spacing: 2) {
                Capsule().fill(MobileStyle.text).frame(width: 14, height: 3)
                Capsule().fill(MobileStyle.muted).frame(width: 14, height: 3)
            }
            Text(
                "Top: 5 hours · Bottom: week · percent used",
                comment: "Explains the two bars of each account on a machine card")
        }
        .font(.caption)
        .foregroundStyle(MobileStyle.muted)
        .accessibilityHidden(true)
    }
}

/// The update of the machine's app: what is there, and Restart where a phone may install it.
struct MachineUpdateBanner: View {
    let update: MachineUpdate
    let install: MachineInstallStep
    let start: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(lucide: update.status == "error" ? "triangle-alert" : "download", size: 16)
                .foregroundStyle(update.status == "error" ? MobileStyle.statusNeedsYou : MobileStyle.statusRunning)
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    install == .started
                        ? String(localized: "Installing. The machine comes back on the new version in a moment.")
                        : update.headline ?? ""
                )
                    .font(.subheadline)
                if let note = update.note, install != .started {
                    Text(note).font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
            Spacer(minLength: 8)
            if let action = update.action, install != .started {
                Button(action: start) {
                    if install == .asking || install == .installing {
                        ProgressView()
                    } else {
                        Text(action).font(.footnote.weight(.semibold))
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(MobileStyle.text)
                .foregroundStyle(MobileStyle.canvas)
                .disabled(install == .asking || install == .installing)
            }
        }
        .padding(.vertical, 2)
    }
}
