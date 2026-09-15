import RuimtePulsar
import RuimteTransport
import SwiftUI

struct ProcessesPage: View {
    let client: any MachineRequesting
    let cwd: String
    @State private var state = RemotePageState()
    @State private var sample: JSONValue?
    @State private var scope = "ruimte"
    @State private var sort = "cpu"
    @State private var target: JSONValue?
    var body: some View {
        List {
            Picker("Processes", selection: $scope) {
                Text("Ruimte").tag("ruimte")
                Text("All processes").tag("all")
            }.pickerStyle(.segmented)
            Picker("Sort by", selection: $sort) {
                Text("CPU").tag("cpu")
                Text("Memory").tag("memory")
                Text("Disk").tag("disk")
            }
            RemotePageStatus(state: state) { Task { await load() } }
            if state.value?["supported"] == .bool(false) {
                ContentUnavailableView(
                    "Process monitoring unavailable", systemImage: "waveform.path",
                    description: Text("This machine does not support process sampling."))
            }
            if let sample {
                if let machine = sample["machine"] {
                    Section("Machine") {
                        LabeledContent(
                            "CPU",
                            value: machine["cpu"]?.numberValue.map { String(format: "%.1f%%", $0) } ?? "Unavailable")
                        LabeledContent(
                            "Memory",
                            value:
                                "\(mobileByteCount(machine["memoryUsed"]?.numberValue)) / \(mobileByteCount(machine["memoryTotal"]?.numberValue))"
                        )
                        LabeledContent("Disk free", value: mobileByteCount(machine["diskFree"]?.numberValue))
                    }.monospacedDigit()
                }
                ForEach(sample.list("groups").filter { scope == "all" || $0.text("kind") != "other" }, id: \.stableID) {
                    group in
                    Section(group.text("kind").capitalized) {
                        ForEach(
                            Array(group.list("processes").sorted { metric($0) > metric($1) }.enumerated()), id: \.offset
                        ) { item in
                            let process = item.element
                            Button {
                                target = process
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(process.text("name")).foregroundStyle(.primary)
                                        Text("PID \(Int(process.number("pid")))").font(.caption).foregroundStyle(
                                            .secondary)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 4) {
                                        Text(
                                            process["cpu"]?.numberValue.map { String(format: "%.1f%%", $0) }
                                                ?? "Unavailable")
                                        Text(mobileByteCount(process["memory"]?.numberValue)).font(.caption)
                                    }.foregroundStyle(.secondary).monospacedDigit()
                                }.padding(.vertical, 4)
                            }.disabled(state.busy)
                        }
                        if group.number("hidden") > 0 {
                            Text("\(Int(group.number("hidden"))) more processes").font(.caption).foregroundStyle(
                                .secondary)
                        }
                    }
                }
                if sample.list("groups").isEmpty {
                    ContentUnavailableView("No processes", systemImage: "waveform.path")
                }
            }
        }.navigationTitle("Processes")
            .task {
                let cancelSample = client.subscribe("processes.sample") { value in sample = value }
                defer { cancelSample() }
                await RemotePageLifecycle.run(
                    client: client,
                    subscription: {
                        client.acquireSubscription(
                            start: "processes.subscribe", stop: "processes.unsubscribe",
                            payload: .object(["scope": .string("all"), "sort": .string("cpu")]),
                            stopPayload: .object([:]))
                    }, load: load)
            }
            .confirmationDialog(
                "Send a signal to \(target?.text("name") ?? "this process")?",
                isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }),
                titleVisibility: .visible
            ) {
                Button("Interrupt (SIGINT)", role: .destructive) { signal("SIGINT") }
                Button("Terminate (SIGTERM)", role: .destructive) { signal("SIGTERM") }
                Button("Force stop (SIGKILL)", role: .destructive) { signal("SIGKILL") }
                Button("Cancel", role: .cancel) { target = nil }
            } message: {
                Text("This affects the process on the machine. Unsaved work may be lost.")
            }
    }
    private func metric(_ process: JSONValue) -> Double {
        sort == "disk" ? process.number("diskRead") + process.number("diskWrite") : process.number(sort)
    }
    private func load() async {
        await state.load {
            let result = try await client.request(
                "processes.subscribe", payload: .object(["scope": .string("all"), "sort": .string("cpu")]))
            sample = result["sample"] == .null ? nil : result["sample"]
            return result
        }
    }
    private func signal(_ signal: String) {
        guard let process = target else { return }
        target = nil
        Task {
            await state.perform {
                _ = try await client.request(
                    "processes.signal",
                    payload: .object([
                        "pid": .number(process.number("pid")), "startTime": .number(process.number("startTime")),
                        "signal": .string(signal),
                    ]))
            }
        }
    }
}
