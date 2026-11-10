import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The projects a machine knows, newest first, kept on the phone so a machine's page counts them before it answers.
@MainActor @Observable
final class MachineProjectList {
    private(set) var projects: [ProjectSummary] = []
    let work = RemotePageState()
    @ObservationIgnored private let session: SharedMachineSession
    // A machine that takes `project.watch` says when a project it does not hold changed on disk; the summary events
    // only cover the projects some client holds.
    @ObservationIgnored private lazy var live = LiveResource(
        client: session.rpc, events: [.reread(.projectSummary), .reread(.projectListChanged)],
        watch: .area(.projectWatch, gated: true), read: { [weak self] in await self?.load() })

    init(session: SharedMachineSession) {
        self.session = session
        if let data = UserDefaults.standard.data(forKey: cacheKey), let cached = try? JSONValue.decode(data) {
            projects = (cached.arrayValue ?? []).compactMap { try? $0.decoded(as: ProjectSummary.self) }
        }
    }

    private var cacheKey: String { ProjectsCache.key(machineID: session.machine.id) }

    /// The projects without the machine's Chats project, which has a row of its own.
    var listed: [ProjectSummary] { projects.filter { !$0.isChats } }
    var chats: ProjectSummary? { projects.first(where: \.isChats) }

    func follow() { live.start() }

    func unfollow() { live.stop() }

    func load() async {
        guard session.connected else { return }
        let connection = session.generation
        await work.read(loaded: false) { stillTheLatest in
            let result = try await session.rpc.request(.projectList)
            try stillTheLatest()
            // An answer for a link that has since been rebuilt says nothing about the one on screen now.
            guard connection == session.generation else { throw CancellationError() }
            projects = try result.decoded(as: ProjectListResult.self).projects.sorted {
                $0.lastOpenedAt > $1.lastOpenedAt
            }
            if let data = try? JSONEncoder().encode(projects) { UserDefaults.standard.set(data, forKey: cacheKey) }
        }
    }
}

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
                Section {
                    MachineProjectsHeading(title: String(localized: "Chats"))
                    if session.connected {
                        NewChatRow(machines: [session.machine]) { _ in newChat = true }
                    }
                    if let chats = list.chats {
                        Button {
                            openWorkspace(
                                MobileWorkspace(session: session, projectID: chats.projectId, summary: chats))
                        } label: {
                            ChatsRowLabel(
                                title: String(localized: "Chats"), detail: String(localized: "Earlier chats"),
                                icon: "messages-square")
                        }
                        .modifier(MobileSidebarRow())
                    }
                }
            }
            Section {
                MachineProjectsHeading(title: String(localized: "Projects"))
                ForEach(
                    list.listed.filter {
                        $0.available && (search.isEmpty || $0.name.localizedCaseInsensitiveContains(search))
                    },
                    id: \.projectId
                ) { project in
                    Button {
                        openWorkspace(
                            MobileWorkspace(session: session, projectID: project.projectId, summary: project))
                    } label: {
                        ProjectHomeRow(
                            summary: project, machine: session.machine.name, connected: session.connected,
                            session: session
                        )
                        .modifier(MobileSidebarLabel())
                    }
                    .modifier(MobileSidebarRow())
                }
                if list.work.loading {
                    MobileLoadingRow(String(localized: "Loading projects"))
                } else if session.connected && list.listed.isEmpty {
                    ContentUnavailableView(
                        String(localized: "No projects yet"), lucideIcon: "folder",
                        description: Text("Open a folder on this machine."))
                }
            }
            if let problem = list.work.problem {
                Section {
                    Text(problem).foregroundStyle(MobileStyle.statusError)
                    Button("Try again") { Task { await list.load() } }
                }
            }
        }
        .navigationTitle("Projects")
        .navigationSubtitle(session.machine.name)
        .searchable(text: $search, prompt: "Find a project")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "Open folder"), lucideIcon: "folder-open") { openingFolder = true }
                    .disabled(!session.connected)
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

/// The title of a group of the machine's projects. A row and not the section's header: a plain list pins its headers
/// under the bar.
private struct MachineProjectsHeading: View {
    let title: String

    var body: some View {
        Text(verbatim: title).font(.caption.weight(.semibold)).foregroundStyle(MobileStyle.muted)
            .padding(.top, MobileSpacing.large)
            .listRowInsets(EdgeInsets(top: 0, leading: 28, bottom: MobileSpacing.xSmall, trailing: 28))
            .accessibilityAddTraits(.isHeader)
    }
}

struct OpenFolderSheet: View {
    let session: SharedMachineSession
    @State private var projectName = ""
    @State private var folder: String
    @State private var createFolder = false
    @State private var work = RemotePageState()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openMobileWorkspace) private var openWorkspace

    /// Opens with the machine's start folder filled in, since that is where a person keeps their work there.
    init(session: SharedMachineSession) {
        self.session = session
        _folder = State(initialValue: session.endpoint.startFolder ?? "")
    }

    var body: some View {
        NavigationStack {
            MobileForm {
                TextField("Name", text: $projectName)
                TextField(
                    "Folder on this machine", text: $folder,
                    prompt: Text(verbatim: MachinePath(platform: session.endpoint.platform).example)
                )
                .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Toggle("Create folder if missing", isOn: $createFolder)
                if let problem = work.problem { Text(problem).foregroundStyle(MobileStyle.statusError) }
            }
            .navigationTitle("Open project")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) { Task { await open() } }
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
            let result = try await session.rpc.request(.projectOpen, payload: .object(payload))
            if let id = try? result.decoded(as: ProjectOpenResult.self).summary.projectId {
                session.retainProject(id)
                await session.releaseProject(id)
                openWorkspace(MobileWorkspace(session: session, projectID: id))
            }
            dismiss()
        }
    }
}
