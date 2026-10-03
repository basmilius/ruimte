import AppIntents
import LucideSwift
import RuimtePulsar
import SwiftUI
import WidgetKit

/// The views of one project with their state, each opening that view. Large, so the views of a project fit.
struct ProjectWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: ProjectWidgetStore.kind, intent: ProjectWidgetIntent.self, provider: ProjectTimeline())
        { entry in
            ProjectWidgetContent(entry: entry)
        }
        .configurationDisplayName("Project")
        .description("The views of one project and what each is doing. Tap one to open it.")
        .supportedFamilies([.systemLarge, .systemExtraLarge])
    }
}

struct ProjectWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Project"
    static let description = IntentDescription("The views of one project and what each is doing.")

    @Parameter(title: "Project") var project: ProjectWidgetEntity?
}

struct ProjectWidgetEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
    static let defaultQuery = ProjectWidgetQuery()
    let id: String
    let name: String
    let machineName: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(machineName)")
    }

    init(_ project: ProjectWidgetProject) {
        id = project.id
        name = project.name
        machineName = project.machineName
    }
}

struct ProjectWidgetQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ProjectWidgetEntity] {
        projects.filter { identifiers.contains($0.id) }.map(ProjectWidgetEntity.init)
    }

    func suggestedEntities() async throws -> [ProjectWidgetEntity] {
        projects.map(ProjectWidgetEntity.init)
    }

    func defaultResult() async -> ProjectWidgetEntity? {
        projects.first.map(ProjectWidgetEntity.init)
    }

    private var projects: [ProjectWidgetProject] { ProjectWidgetStore.snapshot()?.projects ?? [] }
}

struct ProjectEntry: TimelineEntry {
    let date: Date
    /// Nil until the app has written the project, or when it is no longer open.
    let project: ProjectWidgetProject?
    /// Whether the app has written anything yet.
    let recorded: Bool

    static var sample: ProjectEntry {
        ProjectEntry(
            date: .now,
            project: ProjectWidgetProject(
                machineID: "sample", projectID: "recipes", name: "Recept Maker", machineName: "MacBook Pro",
                views: [
                    ProjectWidgetView(id: "a", title: "Refactor reconnect loop", icon: "message-square", state: .needsYou),
                    ProjectWidgetView(id: "b", title: "Shopping list", icon: "message-square", state: .working),
                    ProjectWidgetView(id: "c", title: "bun dev", icon: "terminal", state: .working),
                    ProjectWidgetView(id: "d", title: "Main canvas", icon: "layout-grid", state: .idle),
                ]), recorded: true)
    }
}

/// Only the app knows when something changes, and it reloads the widget when it writes.
struct ProjectTimeline: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ProjectEntry { .sample }

    func snapshot(for configuration: ProjectWidgetIntent, in context: Context) async -> ProjectEntry {
        let entry = entry(for: configuration)
        return context.isPreview && !entry.recorded ? .sample : entry
    }

    func timeline(for configuration: ProjectWidgetIntent, in context: Context) async -> Timeline<ProjectEntry> {
        Timeline(entries: [entry(for: configuration)], policy: .never)
    }

    private func entry(for configuration: ProjectWidgetIntent) -> ProjectEntry {
        let snapshot = ProjectWidgetStore.snapshot()
        let projects = snapshot?.projects ?? []
        let project =
            configuration.project.map { picked in projects.first { $0.id == picked.id } } ?? projects.first
        return ProjectEntry(date: .now, project: project, recorded: snapshot != nil)
    }
}

private struct ProjectWidgetContent: View {
    let entry: ProjectEntry
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetFamily) private var family

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let project = entry.project {
                VStack(alignment: .leading, spacing: 1) {
                    Text(project.name).font(.headline).lineLimit(1)
                    Text(project.machineName).font(.caption).foregroundStyle(color(RuimteColors.muted))
                }
                if project.views.isEmpty {
                    message("This project has no views yet.")
                } else {
                    ForEach(project.views.prefix(family == .systemExtraLarge ? 12 : 9)) { view in
                        Link(destination: project.url(for: view) ?? NeedsYouWidgetSnapshot.nowURL) { row(view) }
                    }
                    Spacer(minLength: 0)
                }
            } else {
                message(entry.recorded ? "This project is no longer open." : "Open Ruimte to see your projects.")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(NeedsYouWidgetSnapshot.nowURL)
        .containerBackground(color(RuimteColors.surface), for: .widget)
    }

    private func row(_ view: ProjectWidgetView) -> some View {
        HStack(spacing: 8) {
            LucideIcon(Self.icon(view.icon), size: 14).foregroundStyle(color(RuimteColors.muted))
            Text(view.title).font(.subheadline).lineLimit(1)
            Spacer(minLength: 6)
            switch view.state {
            case .needsYou:
                Text("Needs you").font(.caption.weight(.semibold)).foregroundStyle(color(RuimteColors.statusNeedsYou))
            case .working:
                Text("Working").font(.caption).foregroundStyle(color(RuimteColors.statusRunning))
            case .idle:
                EmptyView()
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func message(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(color(RuimteColors.muted))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func color(_ token: RuimteColorToken) -> Color {
        RuimteColorToken.color(scheme == .dark ? token.dark : token.light)
    }

    private static let names: [String: LucideIconName] = Dictionary(
        LucideIconName.allCases.map { ($0.rawValue.lowercased(), $0) }, uniquingKeysWith: { first, _ in first })

    /// The view's mark by its Lucide name, as the app resolves it.
    private static func icon(_ name: String) -> LucideIconName {
        names[name.replacingOccurrences(of: "-", with: "").lowercased()] ?? .circleQuestionMark
    }
}
