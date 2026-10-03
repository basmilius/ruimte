import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The projects a machine knows, newest first, kept on the phone so a machine's page counts them before it answers.
@MainActor @Observable
final class MachineProjectList {
    private(set) var projects: [JSONValue] = []
    let work = RemotePageState()
    @ObservationIgnored private let session: SharedMachineSession
    @ObservationIgnored private var unsubscribe: (() -> Void)?

    init(session: SharedMachineSession) {
        self.session = session
        if let data = UserDefaults.standard.data(forKey: cacheKey), let cached = try? JSONValue.decode(data) {
            projects = cached.arrayValue ?? []
        }
    }

    private var cacheKey: String { "ruimte.ios.projects.\(session.machine.id)" }

    /// The projects without the machine's Chats project, which has a row of its own.
    var listed: [JSONValue] { projects.filter { !NewChat.isChats($0) } }
    var chats: JSONValue? { projects.first(where: NewChat.isChats) }

    func follow() {
        guard unsubscribe == nil else { return }
        unsubscribe = session.rpc.subscribe("project.summary") { [weak self] _ in
            Task { await self?.load() }
        }
    }

    func unfollow() {
        unsubscribe?()
        unsubscribe = nil
    }

    func load() async {
        guard session.connected else { return }
        let connection = session.generation
        await work.read(loaded: false) { stillTheLatest in
            let result = try await session.rpc.request("project.list", payload: .object([:]))
            try stillTheLatest()
            // An answer for a link that has since been rebuilt says nothing about the one on screen now.
            guard connection == session.generation else { throw CancellationError() }
            projects = result.list("projects").sorted { $0.number("lastOpenedAt") > $1.number("lastOpenedAt") }
            if let data = try? JSONValue.array(projects).encoded() { UserDefaults.standard.set(data, forKey: cacheKey) }
        }
    }
}

/// A machine's chats and projects, pushed from its page.
struct MachineProjectsPage: View {
    @Bindable var session: SharedMachineSession
    let list: MachineProjectList
    @State private var search = ""
    @State private var openingFolder = false
    @State private var newChat = false
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        MobileList {
            if session.connected || list.chats != nil {
                Section("Chats") {
                    if session.connected {
                        NewChatRow(machines: [session.machine]) { _ in newChat = true }
                    }
                    if let chats = list.chats {
                        Button {
                            openWorkspace(
                                MobileWorkspace(session: session, projectID: chats.text("projectId"), summary: chats))
                        } label: {
                            ChatsRowLabel(title: "Chats", detail: "Your earlier chats", icon: "messages-square")
                        }
                        .modifier(MobileSidebarRow())
                    }
                }
            }
            Section("Projects") {
                ForEach(
                    list.listed.filter { search.isEmpty || $0.text("name").localizedCaseInsensitiveContains(search) },
                    id: \.stableID
                ) { project in
                    Button {
                        openWorkspace(
                            MobileWorkspace(session: session, projectID: project.text("projectId"), summary: project))
                    } label: {
                        ProjectHomeRow(
                            summary: project, machine: session.machine.name, connected: session.connected,
                            session: session
                        )
                        .modifier(MobileSidebarLabel())
                    }
                    .disabled(project["available"] == .bool(false))
                    .modifier(MobileSidebarRow())
                }
                if list.work.loading {
                    MobileLoadingRow("Loading projects")
                } else if session.connected && list.listed.isEmpty {
                    ContentUnavailableView(
                        "No projects yet", lucideIcon: "folder",
                        description: Text("Open a folder on this machine."))
                }
            }
            if let problem = list.work.problem {
                Section {
                    Text(problem).foregroundStyle(.red)
                    Button("Try again") { Task { await list.load() } }
                }
            }
        }
        .navigationTitle("Projects")
        .navigationSubtitle(session.machine.name)
        .searchable(text: $search, prompt: "Find a project")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Open folder", lucideIcon: "folder-open") { openingFolder = true }.disabled(!session.connected)
            }
        }
        .refreshable { await list.load() }
        .mobileSheet(isPresented: $newChat) {
            NewChatSheet(session: session) { place in
                openWorkspace(MobileWorkspace(session: session, projectID: place.projectID), view: place.viewID)
            }
        }
        .mobileSheet(isPresented: $openingFolder) {
            OpenFolderSheet(session: session)
        }
    }
}

/// Opens a folder on the machine as a project, and the project once it is there.
struct OpenFolderSheet: View {
    let session: SharedMachineSession
    @State private var projectName = ""
    @State private var folder = ""
    @State private var createFolder = false
    @State private var work = RemotePageState()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        NavigationStack {
            MobileForm {
                TextField("Name", text: $projectName)
                TextField("Folder on this machine", text: $folder).textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Toggle("Create folder if missing", isOn: $createFolder)
                if let problem = work.problem { Text(problem).foregroundStyle(.red) }
            }
            .navigationTitle("Open project")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Open") { Task { await open() } }
                        .disabled(work.busy || folder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func open() async {
        let path = folder.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return }
        var payload: [String: JSONValue] = ["folder": .string(path), "createFolder": .bool(createFolder)]
        if !projectName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["name"] = .string(projectName)
        }
        await work.perform {
            let result = try await session.rpc.request("project.open", payload: .object(payload))
            if let id = result["summary"]?["projectId"]?.stringValue {
                session.retainProject(id)
                await session.releaseProject(id)
                openWorkspace(MobileWorkspace(session: session, projectID: id))
            }
            dismiss()
        }
    }
}
