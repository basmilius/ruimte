import Charts
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What runs on a machine: three charts of the machine against the share of Ruimte, then a group per node with the
/// processes under it. A warning sits under the group it is about, with the button that fits. Long-press a node's
/// group or a process to signal it; Force quit asks first, as on the desktop.
struct ProcessesPage: View {
    /// Node titles by id, for the project this page was opened from; a machine's own page knows none.
    let titles: [String: String]
    @State private var model: ProcessesModel
    @State private var projectNames: [String: String] = [:]
    @State private var forcing: ProcessTarget?

    init(client: any MachineRequesting, titles: [String: String] = [:]) {
        self.titles = titles
        _model = State(initialValue: ProcessesModel(client: client))
    }

    var body: some View {
        MobileList {
            Section {
                Picker("Which processes", selection: $model.scope) {
                    Text("Ruimte").tag("ruimte")
                    Text("All").tag("all")
                }
                .pickerStyle(.segmented)
            }
            if let problem = model.problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            }
            content
        }
        .navigationTitle("Processes")
        .navigationBarTitleDisplayMode(.inline)
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
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .task { await readProjectNames() }
        .confirmationDialog(
            forcing.map { ProcessesText.forceQuestion($0).title } ?? "",
            isPresented: Binding(get: { forcing != nil }, set: { if !$0 { forcing = nil } }),
            titleVisibility: .visible, presenting: forcing
        ) { target in
            Button("Force quit", role: .destructive) { Task { await model.signal(target, .kill) } }
            Button("Cancel", role: .cancel) {}
        } message: { target in
            Text(ProcessesText.forceQuestion(target).detail)
        }
    }

    @ViewBuilder private var content: some View {
        if model.unsupportedMachine {
            ContentUnavailableView(
                "Needs an update", lucideIcon: "circle-alert",
                description: Text("Update Ruimte on this machine to see its processes on the phone."))
        } else if model.supported == false {
            ContentUnavailableView(
                "Not available", lucideIcon: "activity",
                description: Text("Process monitoring is not available on this platform yet."))
        } else if !model.connected {
            ContentUnavailableView("The machine is not answering", lucideIcon: "activity")
        } else if let sample = model.sample {
            charts(sample)
            list(sample)
        } else {
            MobileLoadingRow("Measuring processes").frame(maxWidth: .infinity).padding()
        }
    }

    @ViewBuilder private func charts(_ sample: ProcessSample) -> some View {
        let series = ProcessesText.series(
            fine: model.fine, coarse: model.coarse, fineInterval: model.fineInterval,
            coarseInterval: model.coarseInterval)
        let machine = sample.machine
        Section {
            ProcessChart(
                label: "CPU", headline: ProcessesText.percent(machine.cpu), points: series.points,
                window: series.window, end: sample.at, maximum: 100, machine: \.cpu, ruimte: \.cpuRuimte)
            ProcessChart(
                label: "Memory",
                headline: "\(ProcessesText.bytes(machine.memoryUsed)) of \(ProcessesText.bytes(machine.memoryTotal))",
                points: series.points, window: series.window, end: sample.at, maximum: machine.memoryTotal,
                machine: \.memory, ruimte: \.memoryRuimte)
            ProcessChart(
                label: "Disk",
                headline: "Read \(ProcessesText.rate(machine.diskRead)), write \(ProcessesText.rate(machine.diskWrite))",
                points: series.points, window: series.window, end: sample.at,
                maximum: max(1, series.points.compactMap(\.disk).max() ?? 1), machine: \.disk, ruimte: \.diskRuimte)
            if let free = machine.diskFree {
                Text("Disk is the total for the processes Ruimte can read. \(ProcessesText.bytes(free)) free.")
                    .font(.caption).foregroundStyle(MobileStyle.muted)
            }
        } header: {
            HStack {
                Text("This machine, and Ruimte's share")
                Spacer()
                Text(series.fine ? "Last 10 minutes" : "Last 24 hours")
            }
        }
    }

    @ViewBuilder private func list(_ sample: ProcessSample) -> some View {
        let groups = sample.groups
        let placed = Dictionary(grouping: model.alerts) { ProcessesText.placement($0, groups: groups) ?? "" }
        Section("Nodes") {
            ForEach(placed[""] ?? []) { alert in alertRow(alert, now: sample.at) }
            ForEach(groups) { group in
                groupRow(group, alerting: !(placed[group.id] ?? []).isEmpty)
                ForEach(placed[group.id] ?? []) { alert in alertRow(alert, now: sample.at) }
                if model.isOpen(group) {
                    ForEach(group.processes) { process in processRow(process) }
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
            HStack(spacing: 8) {
                Image(lucide: "chevron-right", size: 13).foregroundStyle(MobileStyle.muted)
                    .rotationEffect(.degrees(open ? 90 : 0))
                Image(lucide: Self.icon(group.kind), size: 15).foregroundStyle(MobileStyle.muted)
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
                        Text(group.projectID.flatMap { projectNames[$0] } ?? "another project")
                            .font(.caption).foregroundStyle(MobileStyle.faint).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                numbers(cpu: group.cpu, memory: group.memory, read: group.diskRead, write: group.diskWrite)
            }
            .frame(minHeight: 44)
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
            Text(process.name).font(.caption).foregroundStyle(process.readable ? MobileStyle.text : MobileStyle.faint)
                .lineLimit(1)
            Text(String(process.pid)).font(.caption2).foregroundStyle(MobileStyle.faint).monospacedDigit()
            if let family = process.family {
                Text(family).font(.caption2).foregroundStyle(MobileStyle.faint)
            }
            Spacer(minLength: 8)
            numbers(cpu: process.cpu, memory: process.memory, read: process.diskRead, write: process.diskWrite)
        }
        .padding(.leading, 28 + CGFloat(process.depth) * 12)
        .padding(.vertical, 4)
        .background(highlighted ? MobileStyle.active : .clear, in: RoundedRectangle(cornerRadius: 6))
        .contextMenu {
            if process.signalable { signalMenu(ProcessTarget(process)) }
        }
    }

    @ViewBuilder private func signalMenu(_ target: ProcessTarget) -> some View {
        Section("\(target.name) (\(target.pid))") {
            Button("Interrupt", lucideIcon: "pause") { Task { await model.signal(target, .interrupt) } }
            Button("Terminate", lucideIcon: "circle-stop") { Task { await model.signal(target, .terminate) } }
            Button("Force quit…", lucideIcon: "octagon-x", role: .destructive) { forcing = target }
        }
    }

    private func alertRow(_ alert: ProcessAlert, now: Double) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 6) {
                Image(lucide: "triangle-alert", size: 13).foregroundStyle(MobileStyle.statusNeedsYou)
                Text(ProcessesText.alert(alert, now: now)).font(.caption)
                Spacer(minLength: 4)
                Button("Dismiss", lucideIcon: "x") { Task { await model.dismiss(alert) } }
                    .labelStyle(.iconOnly).frame(minWidth: 32, minHeight: 32)
            }
            HStack(spacing: 8) {
                ForEach(ProcessesText.actions(alert), id: \.rawValue) { action in
                    Button(action.label) { Task { await model.act(alert, action) } }
                        .buttonStyle(.bordered).controlSize(.small)
                }
            }
            .padding(.leading, 19)
        }
        .padding(10)
        .background(MobileStyle.inset, in: RoundedRectangle(cornerRadius: 10))
    }

    private func numbers(cpu: Double?, memory: Double?, read: Double?, write: Double?) -> some View {
        let disk = ProcessesText.disk(read: read, write: write)
        let text = [
            ProcessesText.percent(cpu), ProcessesText.bytes(memory), ProcessesText.rate(disk),
        ]
        return Text(text.joined(separator: " · ")).font(.caption2).monospacedDigit().foregroundStyle(MobileStyle.muted)
            .lineLimit(1)
            .accessibilityLabel("CPU \(text[0]), memory \(text[1]), disk \(text[2])")
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

/// One of the three charts: the machine as a line and the share of Ruimte as the area under it.
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
            HStack {
                Text(label).font(.caption.weight(.medium))
                Spacer()
                Text(headline).font(.caption).monospacedDigit().foregroundStyle(MobileStyle.muted)
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
            .frame(height: 56)
            .accessibilityLabel("\(label), \(headline)")
        }
        .padding(.vertical, 4)
    }
}
