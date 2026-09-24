import AppIntents
import LucideSwift
import RuimtePulsar
import SwiftUI
import WidgetKit

struct UsageWidget: Widget {
    var body: some WidgetConfiguration {
        usageConfiguration(
            provider: nil, intent: UsageWidgetIntent.self, name: "Usage",
            description: "Usage limits and today's cost of one machine.")
    }
}

struct ClaudeUsageWidget: Widget {
    var body: some WidgetConfiguration {
        usageConfiguration(
            provider: "claude", intent: ClaudeUsageWidgetIntent.self, name: "Claude usage",
            description: "Claude limits and today's cost of one machine.")
    }
}

struct CodexUsageWidget: Widget {
    var body: some WidgetConfiguration {
        usageConfiguration(
            provider: "codex", intent: CodexUsageWidgetIntent.self, name: "Codex usage",
            description: "Codex limits and today's cost of one machine.")
    }
}

/// The usage of one machine, over every provider or, given one, over that provider alone. WidgetKit on iOS 27.2 trapped
/// on a second widget that shared the first one's intent and built its name, so each brings its own intent and literal.
@MainActor private func usageConfiguration<Intent: UsageConfigurationIntent>(
    provider: String?, intent: Intent.Type, name: LocalizedStringKey, description: LocalizedStringKey
) -> some WidgetConfiguration {
    AppIntentConfiguration(
        kind: UsageWidgetStore.kind(provider: provider), intent: intent, provider: UsageTimeline<Intent>()
    ) { entry in
        UsageWidgetView(entry: entry, provider: provider)
    }
    .configurationDisplayName(name)
    .description(description)
    .supportedFamilies([.systemSmall, .systemMedium])
}

protocol UsageConfigurationIntent: WidgetConfigurationIntent {
    var machine: UsageMachineEntity? { get }
}

struct UsageWidgetIntent: UsageConfigurationIntent {
    static let title: LocalizedStringResource = "Usage"
    static let description = IntentDescription("Usage limits and today's cost of one machine.")

    @Parameter(title: "Machine") var machine: UsageMachineEntity?
}

struct ClaudeUsageWidgetIntent: UsageConfigurationIntent {
    static let title: LocalizedStringResource = "Claude usage"
    static let description = IntentDescription("Claude limits and today's cost of one machine.")

    @Parameter(title: "Machine") var machine: UsageMachineEntity?
}

struct CodexUsageWidgetIntent: UsageConfigurationIntent {
    static let title: LocalizedStringResource = "Codex usage"
    static let description = IntentDescription("Codex limits and today's cost of one machine.")

    @Parameter(title: "Machine") var machine: UsageMachineEntity?
}

struct UsageMachineEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Machine"
    static let defaultQuery = UsageMachineQuery()
    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    init(_ machine: UsageWidgetMachine) {
        id = machine.id
        name = machine.name
    }
}

struct UsageMachineQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [UsageMachineEntity] {
        UsageWidgetStore.machines().filter { identifiers.contains($0.id) }.map(UsageMachineEntity.init)
    }

    func suggestedEntities() async throws -> [UsageMachineEntity] {
        UsageWidgetStore.machines().map(UsageMachineEntity.init)
    }

    func defaultResult() async -> UsageMachineEntity? {
        UsageWidgetStore.machines().first.map(UsageMachineEntity.init)
    }
}

struct UsageEntry: TimelineEntry {
    let date: Date
    let machine: UsageWidgetMachine?
    let snapshot: UsageWidgetSnapshot?

    static var sample: UsageEntry {
        let now = Date.now
        return UsageEntry(
            date: now, machine: UsageWidgetMachine(id: "sample", name: "MacBook Pro"),
            snapshot: UsageWidgetSnapshot(
                providers: [
                    .init(
                        kind: "claude",
                        windows: [
                            .init(kind: "session", label: "Session", used: 0.42, resetsAt: nil),
                            .init(kind: "weekly", label: "Weekly", used: 0.71, resetsAt: nil),
                            .init(kind: "weekly", label: "Weekly · Opus", used: 0.18, resetsAt: nil),
                        ]),
                    .init(kind: "codex", windows: [.init(kind: "weekly", label: "Weekly", used: 0.35, resetsAt: nil)]),
                ], updatedAt: now,
                cost: .init(
                    day: UsageWidgetSnapshot.day(of: now), usd: 15.44, usdByProvider: ["claude": 12.34, "codex": 3.1],
                    rate: nil, fetchedAt: now)))
    }
}

struct UsageTimeline<Intent: UsageConfigurationIntent>: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> UsageEntry { .sample }

    func snapshot(for configuration: Intent, in context: Context) async -> UsageEntry {
        let current = entry(for: configuration, at: .now)
        return context.isPreview && current.snapshot == nil ? .sample : current
    }

    func timeline(for configuration: Intent, in context: Context) async -> Timeline<UsageEntry> {
        let now = Date.now
        let current = entry(for: configuration, at: now)
        // A window that resets or a day that turns changes what the widget says, whether the app runs or not.
        let resets = current.snapshot?.providers.flatMap(\.windows).compactMap(\.resetsAt) ?? []
        let midnight = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: now))
        let moments = Set(resets + [midnight].compactMap { $0 }).filter { $0 > now }.sorted().prefix(12)
        let later = moments.map { UsageEntry(date: $0, machine: current.machine, snapshot: current.snapshot) }
        return Timeline(entries: [current] + later, policy: .atEnd)
    }

    private func entry(for configuration: Intent, at date: Date) -> UsageEntry {
        let machines = UsageWidgetStore.machines()
        let id = configuration.machine?.id ?? machines.first?.id
        let machine = machines.first { $0.id == id }
        return UsageEntry(
            date: date, machine: machine, snapshot: machine.flatMap { UsageWidgetStore.snapshot(machineID: $0.id) })
    }
}

private struct UsageRow: Identifiable {
    let id: String
    let provider: String
    let label: String
    let title: String
    let used: Double
}

struct UsageWidgetView: View {
    let entry: UsageEntry
    let provider: String?
    @Environment(\.widgetFamily) private var family
    @Environment(\.locale) private var locale

    var body: some View {
        let theme = UsageTheme(provider: provider)
        content
            .fontDesign(theme.fontDesign)
            .environment(\.usageTheme, theme)
            .containerBackground(for: .widget) { UsageBackdrop(theme: theme) }
    }

    @ViewBuilder private var content: some View {
        if let machine = entry.machine {
            VStack(alignment: .leading, spacing: 10) {
                header(machine)
                if let snapshot = entry.snapshot {
                    if family == .systemMedium { medium(snapshot) } else { small(snapshot) }
                    Spacer(minLength: 0)
                    if let cost = todayCost(snapshot) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Today").font(.caption).foregroundStyle(.secondary)
                            Spacer(minLength: 4)
                            Text(cost).font(.headline).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                        }
                    }
                } else {
                    message("Open Ruimte while this machine is online to load its usage.")
                }
            }
        } else {
            message("Open Ruimte and choose a machine for this widget.")
        }
    }

    @ViewBuilder private func small(_ snapshot: UsageWidgetSnapshot) -> some View {
        let weeklies = rows(snapshot, kind: "weekly", limit: 2)
        if weeklies.isEmpty {
            message("No weekly limit reported.")
        } else {
            ForEach(weeklies) { UsageBarRow(row: $0, marked: provider == nil) }
        }
    }

    @ViewBuilder private func medium(_ snapshot: UsageWidgetSnapshot) -> some View {
        let session = rows(snapshot, kind: "session", limit: 1).first
        let weeklies = rows(snapshot, kind: "weekly", limit: 3)
        if session == nil && weeklies.isEmpty {
            message("No usage limits reported.")
        } else {
            HStack(alignment: .center, spacing: 16) {
                if let session { UsageRing(row: session).padding(.top, 6) }
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(weeklies) { UsageBarRow(row: $0, marked: provider == nil) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func header(_ machine: UsageWidgetMachine) -> some View {
        HStack(spacing: 6) {
            if let provider { ProviderMark(provider: provider, size: 12) }
            Text(machine.name).font(.caption.weight(.semibold)).lineLimit(1)
            Spacer(minLength: 4)
            if let updatedAt = entry.snapshot?.updatedAt {
                Text(updated(updatedAt)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
        }
    }

    private func message(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func updated(_ date: Date) -> String {
        if Calendar.current.isDate(date, inSameDayAs: entry.date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }

    /// The windows of one kind, shared evenly between the providers that report one.
    private func rows(_ snapshot: UsageWidgetSnapshot, kind: String, limit: Int) -> [UsageRow] {
        let providers = snapshot.providers.filter { reported in
            (provider == nil || reported.kind == provider) && reported.windows.contains { $0.kind == kind }
        }
        let each = max(1, limit / max(1, providers.count))
        let rows = providers.flatMap { provider in
            provider.windows.filter { $0.kind == kind }.prefix(each).map { window in
                // Past its reset a window starts over; the app has not heard the new number yet.
                let reset = window.resetsAt.map { $0 <= entry.date } ?? false
                return UsageRow(
                    id: "\(provider.kind):\(window.label)", provider: provider.kind, label: window.label,
                    title: title(provider: provider.kind, label: window.label),
                    used: reset ? 0 : window.used)
            }
        }
        return Array(rows.prefix(limit))
    }

    /// "Weekly · Opus" reads as the model alone. Over every provider the provider's name stands in for "Weekly",
    /// which every weekly row would repeat; in one provider's widget the header already names it.
    private func title(provider kind: String, label: String) -> String {
        let model = label.hasPrefix("Weekly · ") ? String(label.dropFirst("Weekly · ".count)) : nil
        if provider != nil { return model ?? label }
        return [kind.capitalized, model].compactMap { $0 }.joined(separator: " · ")
    }

    private func todayCost(_ snapshot: UsageWidgetSnapshot) -> String? {
        guard let cost = snapshot.cost, cost.day == UsageWidgetSnapshot.day(of: entry.date) else { return nil }
        let usd: Double?
        if let provider { usd = cost.usdByProvider.map { $0[provider] ?? 0 } } else { usd = cost.usd }
        return usd.map { UsageMoneyFormatter(locale: locale, rate: cost.rate).string(usd: $0) }
    }
}

private func usagePercent(_ used: Double) -> Text {
    Text(used, format: .percent.precision(.fractionLength(0)))
}

private struct UsageBarRow: View {
    let row: UsageRow
    let marked: Bool
    @Environment(\.usageTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if marked { ProviderMark(provider: row.provider, size: 12) }
                Text(row.title).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                usagePercent(row.used).fontWeight(.semibold).monospacedDigit()
            }
            .font(.caption)
            if theme.segmented {
                SegmentedBar(value: row.used, tint: theme.tint(row.used))
            } else {
                ProgressView(value: min(max(row.used, 0), 1)).tint(theme.tint(row.used))
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct SegmentedBar: View {
    private static let segments = 20
    let value: Double
    let tint: Color

    var body: some View {
        let filled = Int((min(max(value, 0), 1) * Double(Self.segments)).rounded())
        HStack(spacing: 2) {
            ForEach(0..<Self.segments, id: \.self) { index in
                Rectangle().fill(index < filled ? tint : tint.opacity(0.15))
            }
        }
        .frame(height: 5)
    }
}

private struct UsageRing: View {
    let row: UsageRow
    @Environment(\.usageTheme) private var theme

    var body: some View {
        ZStack {
            Circle().stroke(.quaternary, style: stroke)
            Circle()
                .trim(from: 0, to: min(max(row.used, 0), 1))
                .stroke(theme.tint(row.used), style: stroke)
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                usagePercent(row.used).font(.headline).monospacedDigit()
                Text(row.label).font(.system(size: 10, design: theme.fontDesign)).foregroundStyle(.secondary).lineLimit(
                    1
                ).minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 10)
        }
        .frame(width: 68, height: 68)
        .accessibilityElement(children: .combine)
    }

    private var stroke: StrokeStyle {
        theme.segmented ? StrokeStyle(lineWidth: 7, dash: [3, 2]) : StrokeStyle(lineWidth: 7, lineCap: .round)
    }
}

/// The provider's word mark from the desktop's `ProviderLogo`, in the theme's color. A provider without a mark here,
/// such as one only a newer machine knows, gets a generic icon instead of another provider's mark.
private struct ProviderMark: View {
    let provider: String
    let size: CGFloat
    @Environment(\.usageTheme) private var theme

    var body: some View {
        Group {
            switch provider {
            case "claude", "codex":
                Image(provider == "codex" ? "CodexMark" : "ClaudeMark")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
            default:
                LucideIcon(.bot, size: size)
            }
        }
        .frame(width: size, height: size)
        .foregroundStyle(theme.mark)
        .accessibilityLabel(provider.capitalized)
    }
}
