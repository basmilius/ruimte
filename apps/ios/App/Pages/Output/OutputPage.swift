import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Where a page of Output stands: the machine it reads from, how to reach it again, and what the project calls a chat.
struct OutputContext {
    let client: any MachineRequesting
    let machineName: String
    let reconnect: @MainActor () -> Void
    let chatName: @MainActor (String) -> String?

    @MainActor init(workspace: MobileWorkspace) {
        client = workspace.client
        machineName = workspace.session.machine.name
        let session = workspace.session
        reconnect = { if !session.connected { session.reconnect() } }
        chatName = { [weak workspace] chatID in workspace.flatMap { OutputContext.chatName($0.views, chatID: chatID) } }
    }

    /// For a chat outside any project, which has no views to name a chat by.
    @MainActor init(session: SharedMachineSession, client: any MachineRequesting) {
        self.client = client
        machineName = session.machine.name
        reconnect = { if !session.connected { session.reconnect() } }
        chatName = { _ in nil }
    }

    /// What the project calls a chat: a view of its own, or a node on one of its canvases. Empty for one without a name.
    static func chatName(_ views: [JSONValue], chatID: String) -> String? {
        for view in views {
            if view.stableID == chatID { return view.text("name") }
            if let node = view.list("nodes").first(where: { $0.stableID == chatID }) { return node.text("title") }
        }
        return nil
    }
}

/// What a project saved of its work on the machine, newest first in runs of Today, This week and Earlier. Read only
/// on a phone: an item opens with its versions and where it came from.
struct OutputPage: View {
    @State private var store: ProjectOutput
    @State private var opened: String?
    private let context: OutputContext
    /// Named under the title on an iPhone, whose sheet stands over the project.
    private let projectName: String?

    init(context: OutputContext, projectID: String, projectName: String? = nil) {
        _store = State(initialValue: ProjectOutput(client: context.client, projectID: projectID))
        self.context = context
        self.projectName = projectName
    }

    var body: some View {
        MobileList {
            if store.reachable, let items = store.items, !items.isEmpty {
                TimelineView(.periodic(from: .now, by: 60)) { timeline in
                    ForEach(store.groups(now: timeline.date)) { group in
                        Section(group.title) {
                            ForEach(group.items) { item in row(item, now: timeline.date) }
                        }
                    }
                }
            }
        }
        .overlay { state }
        .navigationTitle("Output")
        .navigationSubtitle(projectName ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $opened) { id in
            OutputItemPage(
                context: context, artifactID: id, title: store.items?.first { $0.id == id }?.title ?? "")
        }
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .refreshable { await store.load() }
    }

    @ViewBuilder private var state: some View {
        if !store.reachable {
            OutputUnreachableView(machineName: context.machineName) {
                context.reconnect()
                Task { await store.load() }
            }
        } else if let items = store.items {
            if items.isEmpty {
                ContentUnavailableView(
                    String(localized: "Nothing saved yet"), lucideIcon: "package",
                    description: Text("Shows what agents publish and the pages and images you save from a chat."))
            }
        } else if let problem = store.problem {
            ContentUnavailableView {
                Label(String(localized: "Could not load Output."), lucideIcon: "triangle-alert", iconSize: 48)
            } description: {
                Text(problem)
            } actions: {
                Button("Try again") { Task { await store.load() } }
            }
        } else {
            MobileLoadingRow(String(localized: "Loading"))
        }
    }

    private func row(_ item: OutputItem, now: Date) -> some View {
        Button {
            opened = item.id
        } label: {
            HStack(spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    OutputKindGlyph(kind: item.kind).centeredOnFirstLine(of: .body)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: item.title).fontWeight(.medium).lineLimit(1)
                        HStack(spacing: 4) {
                            OutputMakerIcon(provenance: item.latest.provenance, size: 12)
                                .foregroundStyle(MobileStyle.faint)
                            Text("\(item.versionCount) versions")
                        }
                        .font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text(Format.moment(item.latest.date, now: now))
                    .font(.caption).monospacedDigit().foregroundStyle(MobileStyle.faint)
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("output.item.\(item.id)")
    }
}

/// The mark of a kind at the start of a row.
struct OutputKindGlyph: View {
    let kind: String

    var body: some View {
        MobileStatusGlyph(tone: .idle, symbol: OutputKind.icon(kind)).accessibilityHidden(true)
    }
}

/// Who made a version as a mark: a person, a routine, or an agent's CLI.
struct OutputMakerIcon: View {
    let provenance: OutputProvenance
    var size: CGFloat = 14

    var body: some View {
        if provenance.maker == .agent, let agent = provenance.agent {
            ChatProviderMark(provider: agent, size: size).accessibilityHidden(true)
        } else {
            Image(lucide: OutputKind.makerIcon(provenance.maker), size: size).accessibilityHidden(true)
        }
    }
}

/// Output never leaves its machine, so a phone without a link to it has nothing to show and says so.
struct OutputUnreachableView: View {
    let machineName: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(String(localized: "\(machineName) is not reachable"), lucideIcon: "wifi-off", iconSize: 48)
        } description: {
            Text("Output stays on that machine. It shows here again once \(machineName) is online.")
        } actions: {
            Button("Try again", action: retry)
        }
    }
}
