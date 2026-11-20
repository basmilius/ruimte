import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The design of a hidden design agent, opened from its card on top of the chat, after `AgentDesignBody.tsx`: its
/// pages and the agent's own thread one in front of the other, as a Design shows them, so a person goes on with the
/// agent that made it. Nothing of it is written to the project; the way back is the back button.
struct AgentDesignPage: View {
    let design: ChatDesignOpen
    let workspace: MobileWorkspace
    @State private var side = DesignPage.Side.pages
    @State private var follow: DesignFollow
    @State private var listing = DesignFiles.Listing()
    @State private var attempt = 0

    init(design: ChatDesignOpen, workspace: MobileWorkspace) {
        self.design = design
        self.workspace = workspace
        _follow = State(initialValue: DesignFollow(shown: design.page, picked: design.picked))
    }

    private var pages: [FsEntry] { listing.pages ?? [] }

    /// The project folder sees the design's folder come; a folder outside it is watched itself.
    private var watched: String {
        design.folder.hasPrefix(workspace.folder + "/") ? workspace.folder : design.folder
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Show", selection: $side) {
                Text("Chat").tag(DesignPage.Side.chat)
                Text("Pages").tag(DesignPage.Side.pages)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16).padding(.vertical, 8)
            switch side {
            case .chat:
                ChatScreen(
                    client: workspace.client, chatID: design.agentID, title: design.title, isPrepared: true,
                    workspace: workspace)
            case .pages: pagesSide
            }
        }
        .navigationTitle(design.title)
        .navigationSubtitle(side == .pages ? follow.shown.map(DesignFiles.pageName) ?? "" : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if side == .pages, !pages.isEmpty {
                ToolbarItem(placement: .topBarTrailing) { pagesMenu }
            }
        }
        .modifier(
            DesignListingWatch(client: workspace.client, folder: design.folder, watched: watched, listing: $listing)
        )
        .onChange(of: listing) { _, listing in follow.update(listing.pages ?? []) }
    }

    @ViewBuilder private var pagesSide: some View {
        VStack(spacing: 0) {
            if let problem = listing.problem {
                SessionErrorBanner(message: problem) {
                    Task {
                        if let read = await DesignFiles.read(design.folder, client: workspace.client) {
                            listing = listing.after(read)
                        }
                    }
                }
            }
            Group {
                if let shown = follow.shown, pages.contains(where: { $0.name == shown }) {
                    let writtenAt = pages.first { $0.name == shown }?.mtime ?? 0
                    DesignPageFrame(
                        client: workspace.client, folder: design.folder, file: shown, design: design.agentID,
                        project: workspace.projectID, fill: true
                    )
                    // A page written again, or read again, opens anew.
                    .id("\(shown):\(writtenAt):\(attempt)")
                    .modifier(MobilePageSurface())
                } else if listing.problem != nil {
                    Color.clear
                } else if listing.pages == nil {
                    MobileLoadingRow(String(localized: "Reading the pages"))
                } else if !listing.found {
                    ContentUnavailableView(String(localized: "The design's folder is gone."), lucideIcon: "folder-x")
                } else {
                    ContentUnavailableView(
                        String(localized: "No pages yet"), lucideIcon: "swatch-book",
                        description: Text("The design shows here once its first page is written."))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var pagesMenu: some View {
        let names = DesignAgentPages.byName(pages.map(\.name))
        return Menu {
            Picker(
                String(localized: "Pages of the design"),
                selection: Binding(get: { follow.shown ?? "" }, set: { follow.pick($0) })
            ) {
                ForEach(names, id: \.self) { name in
                    Text(verbatim: DesignFiles.pageName(name)).tag(name)
                }
            }
            Button(String(localized: "Read again"), lucideIcon: "refresh-cw") { attempt += 1 }
        } label: {
            Label(String(localized: "Pages of the design"), lucideIcon: "file-code")
        }
    }
}
