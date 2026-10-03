import RuimtePulsar
import SwiftUI

/// The desktop's command palette as the Search tab: views, projects, files and commands over every project of every
/// machine, in one list. Text inside chats is not searched.
struct SearchPage: View {
    let now: NowModel
    let projects: UnifiedProjects
    let runtime: AppRuntime
    let navigator: any PaletteNavigator
    let showSettings: () -> Void
    let pair: () -> Void
    @State private var query = ""
    @State private var files = PaletteFiles()
    @State private var newChat: NewChatTarget?
    @State private var usage: NewChatTarget?
    @AppStorage("ruimte.ios.appearance") private var appearance = "system"
    @Environment(\.openMobileWorkspace) private var openWorkspace

    var body: some View {
        let typed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let commands = PaletteCommands.all(projects: projects.open, machines: runtime.machines, appearance: appearance)
        MobileList {
            if typed.isEmpty {
                let waiting = now.board.needsYou.prefix(5)
                if !waiting.isEmpty {
                    Section("Needs you") {
                        ForEach(Array(waiting)) { entry in viewRow(entry, query: "") }
                    }
                }
                Section("Commands") {
                    ForEach(PaletteCommands.featured(commands)) { command in commandRow(command, query: "") }
                }
            } else {
                let views = PaletteRanking.rank(now.entries, query: typed, text: \.title, extra: \.projectName)
                let found = PaletteRanking.rank(
                    projects.open + projects.recent, query: typed, text: { $0.summary.text("name") },
                    extra: { $0.machine.name })
                let matching = PaletteRanking.rank(commands, query: typed, text: \.title)
                if !views.isEmpty {
                    Section("Views") {
                        ForEach(views.prefix(8)) { entry in viewRow(entry, query: typed) }
                    }
                }
                if !found.isEmpty {
                    Section("Projects") {
                        ForEach(found.prefix(5)) { row in projectRow(row) }
                    }
                }
                if !files.results.isEmpty {
                    Section("Files") {
                        ForEach(files.results) { file in fileRow(file, query: typed) }
                    }
                }
                if !matching.isEmpty {
                    Section("Commands") {
                        ForEach(matching.prefix(8)) { command in commandRow(command, query: typed) }
                    }
                }
                if views.isEmpty && found.isEmpty && files.results.isEmpty && matching.isEmpty && !files.searching {
                    ContentUnavailableView.search(text: typed)
                }
            }
        }
        .navigationTitle("Search")
        .searchable(text: $query, prompt: "Views, files and commands")
        .task(id: typed) {
            if typed.count >= PaletteFiles.shortest {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
            await files.search(typed, projects: projects.open) { runtime.session(for: $0).rpc }
        }
        .mobileSheet(item: $newChat) { target in
            if let machine = runtime.machines.first(where: { $0.id == target.machineID }) {
                let session = runtime.session(for: machine)
                NewChatSheet(session: session) { place in
                    openWorkspace(MobileWorkspace(session: session, projectID: place.projectID), view: place.viewID)
                }
            }
        }
        .mobileSheet(item: $usage) { target in
            if let machine = runtime.machines.first(where: { $0.id == target.machineID }) {
                NavigationStack {
                    MachineUsagePage(client: runtime.session(for: machine).rpc)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("Done") { usage = nil } }
                        }
                }
            }
        }
    }

    private func viewRow(_ entry: ProjectViewEntry, query: String) -> some View {
        Button {
            navigator.show(view: entry.target)
        } label: {
            PaletteRow(
                title: entry.title, query: query, detail: viewDetail(entry), icon: entry.iconName)
        }
    }

    private func projectRow(_ row: UnifiedProjectRow) -> some View {
        Button {
            openWorkspace(
                MobileWorkspace(
                    session: runtime.session(for: row.machine), projectID: row.id.projectID, summary: row.summary))
        } label: {
            ProjectHomeRow(
                summary: row.summary, machine: row.machine.name, connected: row.connected,
                session: runtime.session(for: row.machine))
        }
        .disabled(row.summary["available"] == .bool(false))
    }

    private func fileRow(_ file: PaletteFile, query: String) -> some View {
        Button {
            navigator.show(
                file: ProjectFileTarget(
                    machineID: file.project.machineID, projectID: file.project.projectID, path: file.absolutePath))
        } label: {
            PaletteRow(
                title: file.name, query: query, detail: file.place, icon: FileKinds.icon(name: file.name, kind: "file"))
        }
    }

    private func commandRow(_ command: PaletteCommand, query: String) -> some View {
        Button {
            run(command.action)
        } label: {
            PaletteRow(title: command.title, query: query, detail: nil, icon: command.icon)
        }
    }

    private func viewDetail(_ entry: ProjectViewEntry) -> String {
        let place = runtime.machines.count > 1 ? "\(entry.projectName) · \(entry.machineName)" : entry.projectName
        if entry.status == .needsYou && entry.snoozedUntil == nil {
            return String(localized: "\(place) · needs you", comment: "%@ is the project, maybe with its machine")
        }
        if entry.status == .running {
            return String(localized: "\(place) · working", comment: "%@ is the project, maybe with its machine")
        }
        return place
    }

    private func run(_ action: PaletteCommand.Action) {
        switch action {
        case .newChat(let machineID): newChat = NewChatTarget(machineID: machineID)
        case .usage(let machineID): usage = NewChatTarget(machineID: machineID)
        case .openFolder(let machineID): navigator.showMachine(machineID)
        case .recentlyClosed: navigator.showRecentProjects()
        case .pair: pair()
        case .settings: showSettings()
        case .appearance(let value): appearance = value
        case .project(let id, let projectAction):
            guard let row = projects.open.first(where: { $0.id == id }) else { return }
            let navigation = navigator.openProject(
                MobileWorkspace(session: runtime.session(for: row.machine), projectID: id.projectID, summary: row.summary))
            switch projectAction {
            case .newView: navigation.pendingSheet = .newView
            case .newTerminal: navigation.pendingKind = "terminal"
            case .files: navigation.pendingSheet = .files
            case .git: navigation.pendingSheet = .git
            case .launches: navigation.pendingSheet = .launches
            case .settings: navigation.pendingSheet = .settings
            }
        }
    }
}

/// A row of the palette: its mark, its name with the typed words marked, and where it is.
private struct PaletteRow: View {
    let title: String
    let query: String
    let detail: String?
    let icon: String

    var body: some View {
        HStack(spacing: 10) {
            Image(lucide: icon, size: 15).foregroundStyle(MobileStyle.muted)
            VStack(alignment: .leading, spacing: 1) {
                Text(marked).foregroundStyle(MobileStyle.text).lineLimit(1).truncationMode(.tail)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1).truncationMode(.middle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 40)
        .accessibilityElement(children: .combine)
    }

    private var marked: AttributedString {
        var text = AttributedString(title)
        for range in PaletteRanking.highlights(query, in: title) {
            guard let lower = AttributedString.Index(range.lowerBound, within: text),
                let upper = AttributedString.Index(range.upperBound, within: text)
            else { continue }
            text[lower..<upper].backgroundColor = MobileStyle.accent.opacity(0.22)
        }
        return text
    }
}
