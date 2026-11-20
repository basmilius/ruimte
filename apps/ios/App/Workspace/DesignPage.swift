import RuimtePulsar
import RuimteShared
import RuimteTransport
import SwiftUI

/// A design: the chat that works on it and the pages of its folder, one in front of the other since a phone has no
/// room for both side by side, as the desktop draws them.
struct DesignPage: View {
    enum Side: Hashable {
        case chat, pages
    }

    let workspace: MobileWorkspace
    let design: DesignPlace
    let title: String
    @State private var side = Side.chat
    /// The chat a person picked, one device's and never saved, as the desktop keeps it per window.
    @State private var picked: String?
    @State private var ready: String?
    @State private var problem: String?
    @State private var agents: [(kind: String, name: String)] = []

    private var chat: DesignPlace.Chat { design.activeChat(picked: picked) }

    private var folder: String {
        let location = design.location(shared: workspace.document.list("shared").compactMap(\.stringValue))
        return workspace.folder + "/" + location
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Show", selection: $side) {
                Text("Chat").tag(Side.chat)
                Text("Pages").tag(Side.pages)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16).padding(.vertical, 8)
            switch side {
            case .chat: chatSide
            case .pages:
                DesignPagesList(
                    client: workspace.client, folder: folder, workspaceFolder: workspace.folder, design: design.id,
                    project: workspace.projectID)
            }
        }
        .toolbar {
            if side == .chat {
                ToolbarItem(placement: .topBarTrailing) { chatsMenu }
            }
        }
        .task(id: "\(workspace.session.generation):\(chat.id)") { await prepare() }
        .task(id: workspace.session.generation) {
            guard workspace.session.connected, let providers = try? await AgentCatalog.load(workspace.client) else {
                return
            }
            agents = AgentCatalog.installedChats(providers).map { ($0.kind, $0.name) }
        }
    }

    @ViewBuilder private var chatSide: some View {
        if let problem {
            SessionErrorBanner(message: problem) { Task { await prepare() } }
        }
        ChatScreen(
            client: workspace.client, chatID: chat.id, title: title, isPrepared: ready == chat.id,
            workspace: workspace
        )
        .id(chat.id)
    }

    /// Every chat of the design, the oldest first, and a new one on any CLI of the machine, which comes into view.
    private var chatsMenu: some View {
        Menu {
            Picker("Chats of this design", selection: Binding(get: { chat.id }, set: { picked = $0 })) {
                ForEach(design.chats) { chat in Text(chat.name).tag(chat.id) }
            }
            if !agents.isEmpty {
                Menu {
                    ForEach(agents, id: \.kind) { agent in
                        Button(agent.name) { Task { await addChat(agent) } }
                    }
                } label: {
                    Label(String(localized: "New chat"), lucideIcon: "plus")
                }
            }
        } label: {
            Label(String(localized: "Chats of this design"), lucideIcon: "messages-square")
        }
    }

    private func prepare() async {
        guard workspace.ready, workspace.session.connected else { return }
        let shown = chat
        do {
            try await workspace.ensureSession(id: shown.id, kind: "chat", raw: DesignPlace.sessionItem(shown))
            guard !Task.isCancelled else { return }
            ready = shown.id
            problem = nil
        } catch {
            if !Task.isCancelled { problem = error.localizedDescription }
        }
    }

    private func addChat(_ agent: (kind: String, name: String)) async {
        let entry = DesignFiles.chat(agent: agent, count: design.chats.count)
        await workspace.edit { DesignFiles.adding(entry, to: design, in: $0) }
        guard workspace.problem == nil else { return }
        AppUsage.count(.chatStarted)
        picked = entry.stableID
    }
}

/// The pages of the design folder, the most recently changed first, read again whenever something in it changes. The
/// folder may not exist until the chat makes it, so the project folder is the watch that sees it come.
private struct DesignPagesList: View {
    let client: any MachineRequesting
    let folder: String
    let workspaceFolder: String
    let design: String
    let project: String
    @State private var listing = DesignFiles.Listing()
    @State private var open: String?

    var body: some View {
        VStack(spacing: 0) {
            if let problem = listing.problem {
                SessionErrorBanner(message: problem) { Task { await load() } }
            }
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationDestination(item: $open) { file in
            DesignPageView(client: client, folder: folder, file: file, design: design, project: project)
        }
        .modifier(DesignListingWatch(client: client, folder: folder, watched: workspaceFolder, listing: $listing))
        .refreshable { await load() }
    }

    @ViewBuilder private var content: some View {
        Group {
            if let pages = listing.pages, !pages.isEmpty {
                MobileList {
                    ForEach(pages, id: \.name) { page in
                        let name = page.name
                        Button {
                            open = name
                        } label: {
                            HStack {
                                Label {
                                    Text(DesignFiles.pageName(name)).lineLimit(1)
                                } icon: {
                                    Image(lucide: "file-code", size: 18)
                                }
                                Spacer()
                                Text(Format.ago(milliseconds: Date.now.timeIntervalSince1970 * 1000 - page.mtime))
                                    .font(.caption).foregroundStyle(MobileStyle.muted)
                            }
                            .modifier(MobileSidebarLabel(disclosure: true))
                        }
                        .modifier(MobileSidebarRow())
                    }
                }
            } else if listing.problem != nil {
                // The banner above says why; an empty state here would call a failed read a design without pages.
                Color.clear
            } else if listing.pages != nil {
                ContentUnavailableView(
                    String(localized: "No pages yet"), lucideIcon: "swatch-book",
                    description: Text("Ask the chat to make a page. It shows here as soon as it is written."))
            } else {
                MobileLoadingRow(String(localized: "Reading the pages"))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func load() async {
        if let read = await DesignFiles.read(folder, client: client) { listing = listing.after(read) }
    }
}

extension DesignFiles {
    /// The client, for the code that builds a page off the main actor. Every call on it is made on the main actor, so
    /// the page is only ever read through it from there.
    private struct ReadingClient: @unchecked Sendable {
        let client: any MachineRequesting
    }

    @MainActor static func fileReader(_ client: any MachineRequesting)
        -> @Sendable (String, Int) async throws -> MachineResource
    {
        let reading = ReadingClient(client: client)
        return { path, maxBytes in
            try await reading.client.readResource(
                .object(["kind": .string("file"), "path": .string(path)]), maxBytes: maxBytes)
        }
    }

    /// What a page reads while it runs, bounded per time the page is opened.
    @MainActor static func runtimeAssets(_ client: any MachineRequesting, folder: String) -> RuntimeAssets {
        RuntimeAssets(folder: folder, read: fileReader(client))
    }

    /// The entries right in a design's folder; nil when the read was cancelled.
    @MainActor static func read(_ folder: String, client: any MachineRequesting) async -> Result<[FsEntry], Error>? {
        do {
            // Hidden too: git ignores a private design's folder, and a listing leaves out what git ignores.
            let listed = try await client.request(
                .fsList, payload: .object(["path": .string(folder), "depth": .number(1), "hidden": .bool(true)])
            ).decoded(as: FsListResult.self)
            return .success(listed.entries)
        } catch is CancellationError {
            return nil
        } catch {
            return .failure(error)
        }
    }
}

/// Reads the pages of a design folder again whenever something in it changes. The folder may not exist until a chat
/// makes it, so `watched`, a folder above it, is the watch that sees it come.
struct DesignListingWatch: ViewModifier {
    let client: any MachineRequesting
    let folder: String
    let watched: String
    @Binding var listing: DesignFiles.Listing

    func body(content: Content) -> some View {
        let found = listing.found
        // Whether the folder is there decides which changes count, so the watch starts over once it comes or goes.
        content.task(id: "\(folder):\(found)") {
            await RemotePageLifecycle.run(
                client: client, events: [.fsChanged],
                matches: RemotePageLifecycle.typed(FsChangedEvent.self) { [folder] event in
                    event.paths.contains { DesignFiles.changeReaches($0, folder: folder, found: found) }
                },
                watch: { [watched] in fsWatch(path: watched) },
                load: { [client, folder, _listing] in
                    if let read = await DesignFiles.read(folder, client: client) {
                        _listing.wrappedValue = _listing.wrappedValue.after(read)
                    }
                })
        }
    }
}

/// One page of the design in the sandbox a visual runs in, standing on its own with the files it pulls in.
private struct DesignPageView: View {
    let client: any MachineRequesting
    let folder: String
    let file: String
    let design: String
    let project: String
    @State private var failed = false
    @State private var attempt = 0
    /// What the page reads while it runs, bounded per time the page is opened.
    @State private var assets: DesignFiles.RuntimeAssets
    @State private var board = DesignBoardCamera()

    init(client: any MachineRequesting, folder: String, file: String, design: String, project: String) {
        self.client = client
        self.folder = folder
        self.file = file
        self.design = design
        self.project = project
        _assets = State(initialValue: DesignFiles.runtimeAssets(client, folder: folder))
    }

    var body: some View {
        ChatVisualContent(
            visual: ChatVisual(id: "\(folder)/\(file)", title: DesignFiles.pageName(file), at: 0),
            failed: $failed,
            read: {
                try await DesignFiles.page(
                    file, folder: folder, design: design, project: project, client: client,
                    read: DesignFiles.fileReader(client))
            },
            fill: true,
            assets: assets,
            board: board
        )
        .id(attempt)
        .modifier(MobilePageSurface())
        .navigationTitle(DesignFiles.pageName(file))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if board.isBoard {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(String(localized: "Fit design"), lucideIcon: "maximize") { board.fit() }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    failed = false
                    attempt += 1
                    assets = DesignFiles.runtimeAssets(client, folder: folder)
                } label: {
                    Label(String(localized: "Read again"), lucideIcon: "refresh-cw")
                }
            }
        }
    }
}
