import Charts
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What runs on a machine: CPU and memory of the machine against the share of Ruimte, then per project a group per
/// node with the processes under it, and what belongs to no project under Machine tasks. A warning sits under the
/// group it is about, with the button that fits. Long-press a node's
/// group or a process to signal it; Force quit asks first, as on the desktop.
struct ProcessesPage: View {
    /// Node titles by id, for the project this page was opened from; a machine's own page knows none.
    let titles: [String: String]
    @State private var model: ProcessesModel
    @State private var projectNames: [String: String] = [:]
    @State private var forcing: ProcessTarget?
    @State private var order = [KeyPathComparator(\ProcessTableRow.cpu, order: .reverse)]
    @State private var picked = Set<String>()
    @Environment(\.horizontalSizeClass) private var sizeClass

    init(client: any MachineRequesting, titles: [String: String] = [:]) {
        self.titles = titles
        _model = State(initialValue: ProcessesModel(client: client))
    }

    var body: some View {
        Group {
            if wide { table } else { form }
        }
        .navigationTitle("Processes")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .task { await readProjectNames() }
        .alert(
            forcing.map { ProcessesText.forceQuestion($0).title } ?? "",
            isPresented: Binding(get: { forcing != nil }, set: { if !$0 { forcing = nil } }),
            presenting: forcing
        ) { target in
            Button("Force quit", role: .destructive) { Task { await model.signal(target, .kill) } }
            Button("Cancel", role: .cancel) {}
        } message: { target in
            Text(ProcessesText.forceQuestion(target).detail)
        }
    }

    /// An iPad beside its sidebar has the room for the desktop's table.
    private var wide: Bool { UIDevice.current.userInterfaceIdiom == .pad && sizeClass == .regular }

    private var form: some View {
        MobileForm {
            Section {
                Picker("Which processes", selection: $model.scope) {
                    Text("Ruimte").tag("ruimte")
                    Text("All processes").tag("all")
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            if let problem = model.problem {
                Section { Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red) }
            }
            content
        }
        .listSectionSpacing(12)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort by", selection: $model.sort) {
                        Text("CPU").tag("cpu")
                        Text("Memory").tag("memory")
                        Text("Disk").tag("disk")
                    }
                } label: {
                    Image(lucide: "arrow-down-wide-narrow")
                }
                .accessibilityLabel("Sort processes")
            }
        }
    }

    /// The tiles and warnings over a table of every process, sorted by any column, with the signals in a row's menu.
    private var table: some View {
        VStack(spacing: 12) {
            Picker("Which processes", selection: $model.scope) {
                Text("Ruimte").tag("ruimte")
                Text("All processes").tag("all")
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 360)
            .frame(maxWidth: .infinity, alignment: .leading)
            if let problem = model.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            if let sample = model.sample, model.connected, !model.unsupportedMachine, model.supported != false {
                let series = ProcessesText.series(
                    fine: model.fine, coarse: model.coarse, fineInterval: model.fineInterval,
                    coarseInterval: model.coarseInterval)
                HStack(spacing: 8) {
                    ProcessChart(
                        label: String(localized: "CPU"), headline: ProcessesText.percent(sample.machine.cpu), points: series.points,
                        window: series.window, end: sample.at, maximum: 100, machine: \.cpu, ruimte: \.cpuRuimte)
                    ProcessChart(
                        label: String(localized: "Memory"), headline: ProcessesText.bytes(sample.machine.memoryUsed),
                        points: series.points, window: series.window, end: sample.at,
                        maximum: sample.machine.memoryTotal, machine: \.memory, ruimte: \.memoryRuimte)
                }
                .frame(maxHeight: 150)
                ForEach(model.alerts) { alert in
                    alertRow(alert, now: sample.at)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(MobileStyle.statusNeedsYou.opacity(0.1), in: .rect(cornerRadius: 14))
                }
                processTable(sample)
            } else {
                content.frame(maxHeight: .infinity)
            }
        }
        .padding(.horizontal, 20).padding(.top, 8)
        .background(MobileStyle.canvas)
    }

    private func processTable(_ sample: ProcessSample) -> some View {
        let rows = ProcessTableRow.rows(sample.groups, titles: titles, projectNames: projectNames).sorted(using: order)
        return Table(rows, selection: $picked, sortOrder: $order) {
            TableColumn("Process", value: \.name) { row in
                HStack(spacing: 8) {
                    Image(lucide: Self.icon(row.kind), size: 13).foregroundStyle(MobileStyle.muted)
                    Text(row.name).foregroundStyle(row.process.readable ? MobileStyle.text : MobileStyle.faint)
                        .lineLimit(1)
                }
            }
            .width(min: 140, ideal: 200)
            TableColumn("Node", value: \.owner) { row in
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.owner).lineLimit(1)
                    Text(row.place).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                }
            }
            .width(min: 140, ideal: 220)
            TableColumn("PID", value: \.pid) { row in
                Text(String(row.pid)).monospacedDigit().foregroundStyle(MobileStyle.muted)
            }
            .width(70)
            TableColumn("CPU", value: \.cpu) { row in
                Text(ProcessesText.percent(row.process.cpu)).monospacedDigit()
                    .foregroundStyle(row.cpu >= 80 ? MobileStyle.statusNeedsYou : MobileStyle.text)
            }
            .width(70)
            TableColumn("Memory", value: \.memory) { row in
                Text(ProcessesText.bytes(row.process.memory)).monospacedDigit()
            }
            .width(90)
            TableColumn("Disk", value: \.disk) { row in
                Text(ProcessesText.rate(row.disk)).monospacedDigit().foregroundStyle(MobileStyle.muted)
            }
            .width(90)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let row = rows.first(where: { $0.id == id }), row.process.signalable {
                signalMenu(ProcessTarget(row.process))
            }
        }
        .scrollContentBackground(.hidden)
    }

    @ViewBuilder private var content: some View {
        if model.unsupportedMachine {
            ContentUnavailableView(
                String(localized: "Needs an update"), lucideIcon: "circle-alert",
                description: Text("Update Ruimte on this machine to see its processes on the phone."))
        } else if model.supported == false {
            ContentUnavailableView(
                String(localized: "Not available"), lucideIcon: "activity",
                description: Text("Process monitoring is not available on this platform yet."))
        } else if !model.connected {
            ContentUnavailableView(String(localized: "The machine is not answering"), lucideIcon: "activity")
        } else if let sample = model.sample {
            charts(sample)
            list(sample)
        } else {
            MobileLoadingRow(String(localized: "Measuring processes")).frame(maxWidth: .infinity).padding()
        }
    }

    @ViewBuilder private func charts(_ sample: ProcessSample) -> some View {
        let series = ProcessesText.series(
            fine: model.fine, coarse: model.coarse, fineInterval: model.fineInterval,
            coarseInterval: model.coarseInterval)
        let machine = sample.machine
        Section {
            HStack(spacing: 8) {
                ProcessChart(
                    label: String(localized: "CPU"), headline: ProcessesText.percent(machine.cpu), points: series.points,
                    window: series.window, end: sample.at, maximum: 100, machine: \.cpu, ruimte: \.cpuRuimte)
                ProcessChart(
                    label: String(localized: "Memory"), headline: ProcessesText.bytes(machine.memoryUsed), points: series.points,
                    window: series.window, end: sample.at, maximum: machine.memoryTotal, machine: \.memory,
                    ruimte: \.memoryRuimte)
            }
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2).fill(MobileStyle.muted).frame(width: 8, height: 8)
                Text("Machine")
                RoundedRectangle(cornerRadius: 2).fill(MobileStyle.accent).frame(width: 8, height: 8)
                    .padding(.leading, 8)
                Text("Ruimte")
                Spacer()
                Text(series.fine ? "Last 10 minutes" : "Last 24 hours")
            }
            .font(.caption2).foregroundStyle(MobileStyle.muted)
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
            Text(diskLine(machine)).font(.caption2).foregroundStyle(MobileStyle.muted).padding(.horizontal, 4)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))
    }

    /// Disk is the total for the processes Ruimte can read, so it is a line under the two charts and not one of them.
    private func diskLine(_ machine: ProcessMachine) -> String {
        let read = ProcessesText.rate(machine.diskRead)
        let write = ProcessesText.rate(machine.diskWrite)
        guard let free = machine.diskFree else {
            return String(localized: "Disk reads \(read) and writes \(write).")
        }
        return String(localized: "Disk reads \(read) and writes \(write), \(ProcessesText.bytes(free)) free.")
    }

    @ViewBuilder private func list(_ sample: ProcessSample) -> some View {
        let groups = sample.groups
        let placed = Dictionary(grouping: model.alerts) { ProcessesText.placement($0, groups: groups) ?? "" }
        let sections = ProcessesText.sections(groups, projectNames: projectNames)
        if let loose = placed[""], !loose.isEmpty {
            Section {
                ForEach(loose) { alert in alertRow(alert, now: sample.at) }
            }
        }
        ForEach(sections) { section in
            Section {
                ForEach(section.groups) { group in
                    groupRow(group, alerting: !(placed[group.id] ?? []).isEmpty)
                    ForEach(placed[group.id] ?? []) { alert in alertRow(alert, now: sample.at) }
                    if model.isOpen(group) {
                        ForEach(group.processes) { process in processRow(process) }
                    }
                }
            } header: {
                HStack {
                    Label(section.title, lucideIcon: section.id.isEmpty ? "server" : "folder")
                    Spacer()
                    if section.id == sections.first?.id {
                        Text("CPU").frame(width: 44, alignment: .trailing)
                        Text("Memory").frame(width: 60, alignment: .trailing)
                        Color.clear.frame(width: 11, height: 1)
                    }
                }
            }
        }
    }

    private func groupRow(_ group: ProcessGroup, alerting: Bool) -> some View {
        let named = ProcessesText.groupTitle(group, titles: titles)
        let open = model.isOpen(group)
        return Button {
            model.toggle(group)
        } label: {
            HStack(spacing: 9) {
                Image(lucide: Self.icon(group.kind), size: 14).foregroundStyle(MobileStyle.muted).frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(named.title).lineLimit(1)
                        if group.hidden > 0 {
                            Text("+\(group.hidden)").font(.caption).foregroundStyle(MobileStyle.faint).monospacedDigit()
                        }
                        if alerting {
                            Image(lucide: "triangle-alert", size: 12).foregroundStyle(MobileStyle.statusNeedsYou)
                                .accessibilityLabel("Warning")
                        }
                    }
                    if !named.known {
                        Text(group.projectID.flatMap { projectNames[$0] } ?? String(localized: "another project"))
                            .font(.caption).foregroundStyle(MobileStyle.faint).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                numbers(cpu: group.cpu, memory: group.memory)
                Image(lucide: "chevron-right", size: 11).foregroundStyle(MobileStyle.faint)
                    .rotationEffect(.degrees(open ? 90 : 0))
            }
            .font(.callout)
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(open ? "Expanded" : "Collapsed")
        .contextMenu {
            if let root = group.signalableRoot { signalMenu(ProcessTarget(root)) }
        }
    }

    private func processRow(_ process: ProcessRow) -> some View {
        let highlighted = model.highlight?.pid == process.pid && model.highlight?.startTime == process.startTime
        return HStack(spacing: 6) {
            Text(process.name).foregroundStyle(process.readable ? MobileStyle.text : MobileStyle.faint)
                .lineLimit(1)
            Text(String(process.pid)).font(.caption2).foregroundStyle(MobileStyle.faint).monospacedDigit()
            if let family = process.family {
                Text(family).font(.caption2).foregroundStyle(MobileStyle.faint)
            }
            Spacer(minLength: 8)
            numbers(cpu: process.cpu, memory: process.memory)
            Color.clear.frame(width: 11, height: 1)
        }
        .font(.caption)
        .padding(.leading, 27 + CGFloat(process.depth) * 12)
        .padding(.vertical, 2)
        .listRowBackground(highlighted ? MobileStyle.active : MobileStyle.panel)
        .contextMenu {
            if process.signalable { signalMenu(ProcessTarget(process)) }
        }
    }

    @ViewBuilder private func signalMenu(_ target: ProcessTarget) -> some View {
        Section("\(target.name) (\(target.pid))") {
            Button(String(localized: "Interrupt"), lucideIcon: "pause") { Task { await model.signal(target, .interrupt) } }
            Button(String(localized: "Terminate"), lucideIcon: "circle-stop") { Task { await model.signal(target, .terminate) } }
            Button(String(localized: "Force quit…"), lucideIcon: "octagon-x", role: .destructive) { forcing = target }
        }
    }

    private func alertRow(_ alert: ProcessAlert, now: Double) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Image(lucide: "triangle-alert", size: 14).foregroundStyle(MobileStyle.statusNeedsYou)
                Text(ProcessesText.alert(alert, now: now)).font(.footnote)
                Spacer(minLength: 4)
                Button(String(localized: "Dismiss"), lucideIcon: "x") { Task { await model.dismiss(alert) } }
                    .labelStyle(.iconOnly).frame(minWidth: 28, minHeight: 28)
                    .buttonStyle(.borderless)
            }
            HStack(spacing: 6) {
                ForEach(ProcessesText.actions(alert), id: \.rawValue) { action in
                    Button(action.label) { Task { await model.act(alert, action) } }
                        .font(.caption.weight(.semibold))
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .controlSize(.small)
                }
            }
            .padding(.leading, 22)
        }
        .padding(.vertical, 4)
        .listRowBackground(MobileStyle.statusNeedsYou.opacity(0.1))
    }

    /// The two columns of a row; a process that keeps a core busy reads amber.
    private func numbers(cpu: Double?, memory: Double?) -> some View {
        HStack(spacing: 0) {
            Text(ProcessesText.percent(cpu)).frame(width: 44, alignment: .trailing)
                .foregroundStyle((cpu ?? 0) >= 80 ? MobileStyle.statusNeedsYou : MobileStyle.text)
            Text(ProcessesText.bytes(memory)).frame(width: 60, alignment: .trailing)
                .foregroundStyle(MobileStyle.muted)
        }
        .font(.caption).monospacedDigit().lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("CPU \(ProcessesText.percent(cpu)), memory \(ProcessesText.bytes(memory))")
    }

    private static func icon(_ kind: String) -> String {
        switch kind {
        case "terminal": "terminal"
        case "chat": "message-square"
        case "app": "app-window"
        case "daemon": "server"
        default: "cpu"
        }
    }

    /// A group of another project names that project, which the project list knows.
    private func readProjectNames() async {
        guard let result = try? await model.client.request("project.list", payload: .object([:])) else { return }
        projectNames = Dictionary(
            result.list("projects").map { ($0.text("projectId"), $0.text("name")) }, uniquingKeysWith: { first, _ in first })
    }
}

/// A tile of the machine as a line and the share of Ruimte as the area under it.
private struct ProcessChart: View {
    let label: String
    let headline: String
    let points: [ProcessPoint]
    let window: Double
    let end: Double
    let maximum: Double
    let machine: KeyPath<ProcessPoint, Double?>
    let ruimte: KeyPath<ProcessPoint, Double?>

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(.caption2).foregroundStyle(MobileStyle.muted)
                Spacer()
                Text(headline).font(.footnote.weight(.semibold)).monospacedDigit().lineLimit(1)
            }
            Chart {
                ForEach(Array(points.enumerated()), id: \.offset) { item in
                    if let value = item.element[keyPath: ruimte] {
                        AreaMark(
                            x: .value("Time", Date(timeIntervalSince1970: item.element.at / 1000)),
                            y: .value("Ruimte", value)
                        )
                        .foregroundStyle(MobileStyle.accent.opacity(0.3))
                    }
                    if let value = item.element[keyPath: machine] {
                        LineMark(
                            x: .value("Time", Date(timeIntervalSince1970: item.element.at / 1000)),
                            y: .value("Machine", value), series: .value("Series", "machine")
                        )
                        .foregroundStyle(MobileStyle.muted)
                        .lineStyle(StrokeStyle(lineWidth: 1))
                    }
                }
            }
            .chartXScale(
                domain: Date(timeIntervalSince1970: (end - window) / 1000)...Date(timeIntervalSince1970: end / 1000))
            .chartYScale(domain: 0...max(maximum, 1))
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .frame(height: 40)
            .accessibilityLabel("\(label), \(headline)")
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
