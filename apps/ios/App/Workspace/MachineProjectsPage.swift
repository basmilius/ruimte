import RuimtePulsar
import SwiftUI

struct MachineProjectsPage: View {
    @Bindable var session: SharedMachineSession
    let runtime: AppRuntime
    @State private var lease: MachineNavigationLease?
    @State private var projects: [JSONValue] = []
    @State private var search = ""
    @State private var loading = false
    @State private var problem: String?
    @State private var newProject = false
    @State private var projectName = ""
    @State private var folder = ""
    @Environment(\.openMobileWorkspace) private var openWorkspace
    @State private var createFolder = false
    @State private var loadGeneration = 0
    @State private var unsubscribe: (() -> Void)?
    var body: some View {
        List {
            Section {
                HStack {
                    MobileStatus(
                        title: session.connected ? "Connected" : "Connecting",
                        color: session.connected ? .green : .secondary)
                    Spacer()
                    Text("\(projects.count) projects").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                }.padding(.vertical, 3)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                if let problem = session.problem {
                    Text(problem).foregroundStyle(.red)
                    Button("Reconnect") { session.reconnect() }
                }
            }
            Section("Projects") {
                ForEach(
                    projects.filter { search.isEmpty || $0.text("name").localizedCaseInsensitiveContains(search) },
                    id: \.stableID
                ) { project in
                    Button {
                        openWorkspace(MobileWorkspace(session: session, projectID: project.text("projectId")))
                    } label: {
                        ProjectHomeRow(
                            summary: project, machine: session.machine.name, connected: session.connected,
                            session: session)
                    }.disabled(project["available"] == .bool(false))
                        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                }
                if loading {
                    ProgressView("Loading projects")
                } else if session.connected && projects.isEmpty {
                    ContentUnavailableView(
                        "No projects yet", lucideIcon: "folder",
                        description: Text("Open a folder on this machine or create a new workspace."))
                }
            }
            if let problem {
                Section {
                    Text(problem).foregroundStyle(.red)
                    Button("Try again") { Task { await load() } }
                }
            }
            if session.connected {
                Section("Machine") {
                    NavigationLink {
                        MachineFilesPage(client: session.rpc, path: "~")
                    } label: {
                        Label("Files", lucideIcon: "folder")
                    }
                    NavigationLink {
                        MachineUsagePage(client: session.rpc)
                    } label: {
                        Label("Usage", lucideIcon: "chart-no-axes-column")
                    }
                    NavigationLink {
                        MachineDetailsPage(session: session)
                    } label: {
                        Label("Machine settings", lucideIcon: "settings")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(session.machine.name)
        .searchable(text: $search, prompt: "Find a project")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New project", lucideIcon: "plus") { newProject = true }.disabled(!session.connected)
            }
        }
        .task {
            if lease == nil { lease = MachineNavigationLease(session) }
            readCache()
        }
        .task(id: session.generation) { if session.connected { await load() } }
        .refreshable { await load() }
        .onAppear {
            if unsubscribe == nil {
                unsubscribe = session.rpc.subscribe("project.summary") { _ in Task { await load() } }
            }
        }
        .onDisappear {
            unsubscribe?()
            unsubscribe = nil
        }
        .sheet(isPresented: $newProject) {
            NavigationStack {
                Form {
                    TextField("Name", text: $projectName)
                    TextField("Folder on this machine (optional)", text: $folder).textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Toggle("Create folder if missing", isOn: $createFolder)
                    if let problem { Text(problem).foregroundStyle(.red) }
                }.navigationTitle("Open project")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { newProject = false } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Open") { Task { await create() } }.disabled(loading)
                        }
                    }
            }.presentationDetents([.medium, .large])
        }
    }
    private var cacheKey: String { "ruimte.ios.projects.\(session.machine.id)" }
    private func readCache() {
        if let data = UserDefaults.standard.data(forKey: cacheKey), let cached = try? JSONValue.decode(data) {
            projects = cached.arrayValue ?? []
        }
    }
    private func load() async {
        guard session.connected else { return }
        loadGeneration += 1
        let operation = loadGeneration
        let connection = session.generation
        loading = true
        defer { if operation == loadGeneration { loading = false } }
        do {
            let result = try await session.rpc.request("project.list", payload: .object([:]))
            guard !Task.isCancelled, operation == loadGeneration, connection == session.generation else { return }
            projects = result.list("projects").sorted { $0.number("lastOpenedAt") > $1.number("lastOpenedAt") }
            if let data = try? JSONValue.array(projects).encoded() { UserDefaults.standard.set(data, forKey: cacheKey) }
            problem = nil
        } catch { if !Task.isCancelled, operation == loadGeneration { problem = error.localizedDescription } }
    }
    private func create() async {
        loading = true
        defer { loading = false }
        var payload: [String: JSONValue] = [:]
        if !projectName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["name"] = .string(projectName)
        }
        if !folder.isEmpty {
            payload["folder"] = .string(folder)
            payload["createFolder"] = .bool(createFolder)
        }
        do {
            let result = try await session.rpc.request("project.open", payload: .object(payload))
            if let id = result["summary"]?["projectId"]?.stringValue {
                session.retainProject(id)
                await session.releaseProject(id)
                openWorkspace(MobileWorkspace(session: session, projectID: id))
            }
            newProject = false
            problem = nil
        } catch { problem = error.localizedDescription }
    }
}
