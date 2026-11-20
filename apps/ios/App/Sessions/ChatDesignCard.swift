import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What opens a design agent's design from its card: the agent, the folder it works in and the page to start on.
struct ChatDesignOpen: Identifiable, Hashable {
    let agentID: String
    let title: String
    let folder: String
    let page: String?
    /// Whether a person picked `page` on the card, which the design then keeps instead of following the newest.
    let picked: Bool
    var id: String { agentID }
}

/// A design agent's task in its parent's thread, after `DesignTaskCard.tsx`: the row's own line, a 16:9 frame that is
/// there from the start so the thread never jumps, and the pages with the way into the design under it.
struct ChatDesignTaskCard: View {
    let item: ChatSubagentItem
    let agentID: String
    let folder: String
    let workspace: MobileWorkspace
    let presentation: ChatPresentation
    @State private var listing = DesignFiles.Listing()
    @State private var picked: String?

    private var sources: ChatAgentSources? { presentation.agentSources }

    var body: some View {
        let task = ChatSubagents.taskID(item).flatMap { sources?.tasks?.task($0) }
        let state = ChatSubagents.taskRowState(
            item, task: task, childWaiting: ChatSubagents.childWaiting(item, attention: sources?.attention))
        let entries = listing.pages ?? []
        let newestFirst = entries.map(\.name)
        let names = DesignAgentPages.byName(newestFirst)
        // Only a page on disk is known, so the newest one is the page the agent may still be writing while it works.
        let inProgress = state == .running ? newestFirst.first : nil
        let shown = DesignAgentPages.cardPage(newestFirst, picked: picked, result: state == .done ? item.result : nil)
        VStack(alignment: .leading, spacing: 0) {
            Button {
                presentation.conversationRequest = SubagentCrumb(item)
            } label: {
                ChatTaskLine(item: item, sources: sources, open: false, line: line(state, pages: names, inProgress))
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the conversation")
            .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 4)
            frame(shown, entries: entries)
                .padding(.horizontal, 12)
            footer(names: names, shown: shown, inProgress: inProgress, stopped: state == .failed || state == .cancelled)
                .padding(.horizontal, 12).padding(.vertical, 10)
        }
        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
        .modifier(DesignListingWatch(client: workspace.client, folder: folder, watched: watched, listing: $listing))
    }

    /// The project folder sees the design's folder come; a folder outside it is watched itself.
    private var watched: String {
        folder.hasPrefix(workspace.folder + "/") ? workspace.folder : folder
    }

    private func line(_ state: TaskRowState, pages: [String], _ inProgress: String?) -> String? {
        if state == .done {
            return String(localized: "Done · \(pages.count) pages")
        }
        if let inProgress {
            return String(localized: "Wrote \(DesignFiles.pageName(inProgress))", comment: "%@ is the name of a page")
        }
        return nil
    }

    private func frame(_ shown: String?, entries: [FsEntry]) -> some View {
        Color.clear
            .aspectRatio(16 / 9, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay {
                if let shown {
                    DesignPagePreview(
                        client: workspace.client, folder: folder, file: shown, design: agentID,
                        project: workspace.projectID,
                        writtenAt: entries.first { $0.name == shown }?.mtime ?? 0)
                } else {
                    DesignPagePlaceholder()
                }
            }
            .background(MobileStyle.inset)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(MobileStyle.border) }
    }

    @ViewBuilder private func footer(names: [String], shown: String?, inProgress: String?, stopped: Bool) -> some View {
        let pages = pagesControl(names: names, shown: shown, inProgress: inProgress, stopped: stopped)
        // A narrow phone puts the button under the pages instead of cutting either.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                pages
                Spacer(minLength: 8)
                openButton(names: names, shown: shown)
            }
            VStack(alignment: .leading, spacing: 8) {
                pages
                openButton(names: names, shown: shown)
            }
        }
        .frame(minHeight: 28)
    }

    @ViewBuilder private func pagesControl(names: [String], shown: String?, inProgress: String?, stopped: Bool)
        -> some View
    {
        if names.isEmpty {
            Text(
                stopped
                    ? String(localized: "The agent stopped before it wrote a page.")
                    : String(localized: "The design shows here once its first page is written.")
            )
            .font(.caption).foregroundStyle(MobileStyle.faint)
            .fixedSize(horizontal: false, vertical: true)
        } else if names.count == 1, let only = names.first {
            HStack(spacing: 6) {
                pageIcon(only, inProgress: inProgress)
                Text(verbatim: DesignFiles.pageName(only)).lineLimit(1)
            }
            .font(.subheadline).foregroundStyle(MobileStyle.text)
        } else if let shown {
            Menu {
                Picker(
                    String(localized: "Pages of the design"), selection: Binding(get: { shown }, set: { picked = $0 })
                ) {
                    ForEach(names, id: \.self) { name in
                        Label {
                            Text(verbatim: DesignFiles.pageName(name))
                        } icon: {
                            Image(lucide: name == inProgress ? "loader-circle" : "file-code", size: 14)
                        }
                        .tag(name)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    pageIcon(shown, inProgress: inProgress)
                    Text(verbatim: DesignFiles.pageName(shown)).lineLimit(1).foregroundStyle(MobileStyle.text)
                    Image(lucide: "chevrons-up-down", size: 14).foregroundStyle(MobileStyle.muted)
                }
                .font(.subheadline)
                .frame(minHeight: 32).contentShape(Rectangle())
            }
            .accessibilityLabel(
                Text("\(String(localized: "Pages of the design")): \(DesignFiles.pageName(shown))"))
        }
    }

    @ViewBuilder private func pageIcon(_ name: String, inProgress: String?) -> some View {
        if name == inProgress {
            Spinner(size: 14, label: String(localized: "In progress")).foregroundStyle(MobileStyle.accent)
        } else {
            Image(lucide: "file-code", size: 14).foregroundStyle(MobileStyle.muted)
        }
    }

    @ViewBuilder private func openButton(names: [String], shown: String?) -> some View {
        if !names.isEmpty {
            Button {
                presentation.designRequest = ChatDesignOpen(
                    agentID: agentID, title: item.description, folder: folder, page: shown,
                    picked: shown != nil && shown == picked)
            } label: {
                Label(String(localized: "Open design"), lucideIcon: "arrow-up-right", iconSize: 14)
            }
            .buttonStyle(.mobileCapsuleSmall)
            .fixedSize()
        }
    }
}

/// One page laid out at a desktop's width and scaled into the frame, in the sandbox a Design draws it in. It is only
/// a look: no touch reaches it, and VoiceOver reads it as one picture.
private struct DesignPagePreview: View {
    let client: any MachineRequesting
    let folder: String
    let file: String
    let design: String
    let project: String
    let writtenAt: Double

    // The size a page is laid out at before it is scaled down, 16:9 like the frame it fills.
    private static let page = CGSize(width: 1200, height: 675)

    var body: some View {
        GeometryReader { geometry in
            let scale = geometry.size.width / Self.page.width
            DesignPageFrame(client: client, folder: folder, file: file, design: design, project: project)
                // Keyed on when the page was written, since the frame takes a page only as it opens.
                .id("\(file):\(writtenAt)")
                .frame(width: Self.page.width, height: Self.page.height)
                .scaleEffect(scale, anchor: .topLeading)
                .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Preview of \(DesignFiles.pageName(file))"))
        .accessibilityAddTraits(.isImage)
    }
}

/// One page of a design in the sandbox a visual runs in, with what it reads while it runs bounded per time it opens.
/// `fill` scrolls and zooms the page inside, as the Design place shows a page; without it the page only shows.
struct DesignPageFrame: View {
    let client: any MachineRequesting
    let folder: String
    let file: String
    let design: String
    let project: String
    var fill = false
    @State private var failed = false
    @State private var assets: DesignFiles.RuntimeAssets

    init(
        client: any MachineRequesting, folder: String, file: String, design: String, project: String,
        fill: Bool = false
    ) {
        self.client = client
        self.folder = folder
        self.file = file
        self.design = design
        self.project = project
        self.fill = fill
        _assets = State(initialValue: DesignFiles.runtimeAssets(client, folder: folder))
    }

    var body: some View {
        ChatVisualContent(
            visual: ChatVisual(id: "\(folder)/\(file)", title: DesignFiles.pageName(file), at: 0),
            failed: $failed,
            read: { [client, folder, file, design, project] in
                try await DesignFiles.page(
                    file, folder: folder, design: design, project: project, client: client,
                    read: DesignFiles.fileReader(client))
            },
            fill: fill,
            assets: assets
        )
    }
}

/// A page that is not there yet: a bar, a heading beside an image, a row of three, under a slow light. It looks like no
/// design on purpose, so nothing in it is mistaken for what the agent makes.
private struct DesignPagePlaceholder: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            VStack(alignment: .leading, spacing: size.height * 0.06) {
                HStack(spacing: 6) {
                    block(width: size.width * 0.11, height: 4)
                    Spacer(minLength: 0)
                    block(width: size.width * 0.05, height: 3)
                    block(width: size.width * 0.05, height: 3)
                    block(width: size.width * 0.05, height: 3)
                }
                HStack(spacing: size.width * 0.04) {
                    VStack(alignment: .leading, spacing: 4) {
                        block(width: size.width * 0.4, height: 8)
                        block(width: size.width * 0.3, height: 8)
                        block(width: size.width * 0.36, height: 3).padding(.top, 2)
                        block(width: size.width * 0.25, height: 3)
                        block(width: size.width * 0.13, height: 10).padding(.top, 4)
                    }
                    .frame(width: size.width * 0.44, alignment: .leading)
                    RoundedRectangle(cornerRadius: 6).fill(MobileStyle.active)
                }
                .frame(maxHeight: .infinity)
                HStack(spacing: 6) {
                    ForEach(0..<3, id: \.self) { _ in RoundedRectangle(cornerRadius: 4).fill(MobileStyle.active) }
                }
                .frame(height: size.height * 0.16)
            }
            .padding(.horizontal, size.width * 0.05).padding(.vertical, size.height * 0.04)
            .overlay { shine(width: size.width) }
            .clipped()
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .accessibilityHidden(true)
    }

    private func block(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 3).fill(MobileStyle.active).frame(width: width, height: height)
    }

    /// The light the desktop's `design-shine` sweeps across once every 3.2 seconds, eased at both ends.
    private func shine(width: CGFloat) -> some View {
        TimelineView(.animation(paused: reduceMotion || !visible || scenePhase != .active)) { context in
            let cycle = 3.2
            let time = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: cycle) / cycle
            let eased = time * time * (3 - 2 * time)
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0.35), .init(color: MobileStyle.hover, location: 0.5),
                    .init(color: .clear, location: 0.65),
                ], startPoint: .leading, endPoint: .trailing
            )
            .opacity(reduceMotion ? 0 : 0.35)
            .offset(x: (eased * 2 - 1) * width)
        }
        .allowsHitTesting(false)
    }
}
