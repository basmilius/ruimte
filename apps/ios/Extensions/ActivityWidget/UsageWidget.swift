import AppIntents
import RuimtePulsar
import SwiftUI
import WidgetKit

struct UsageWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: UsageWidgetStore.kind, intent: UsageWidgetIntent.self, provider: UsageTimeline()) {
            entry in
            UsageWidgetView(entry: entry)
        }
        .configurationDisplayName("Usage")
        .description("Usage limits and today's cost of one machine.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct UsageWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Usage"
    static let description = IntentDescription("Usage limits and today's cost of one machine.")

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
                        ])
                ], updatedAt: now,
                cost: .init(day: UsageWidgetSnapshot.day(of: now), usd: 12.34, rate: nil, fetchedAt: now)))
    }
}

struct UsageTimeline: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> UsageEntry { .sample }

    func snapshot(for configuration: UsageWidgetIntent, in context: Context) async -> UsageEntry {
        let current = entry(for: configuration, at: .now)
        return context.isPreview && current.snapshot == nil ? .sample : current
    }

    func timeline(for configuration: UsageWidgetIntent, in context: Context) async -> Timeline<UsageEntry> {
        let now = Date.now
        let current = entry(for: configuration, at: now)
        // A window that resets or a day that turns changes what the widget says, whether the app runs or not.
        let resets = current.snapshot?.providers.flatMap(\.windows).compactMap(\.resetsAt) ?? []
        let midnight = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: now))
        let moments = Set(resets + [midnight].compactMap { $0 }).filter { $0 > now }.sorted().prefix(12)
        let later = moments.map { UsageEntry(date: $0, machine: current.machine, snapshot: current.snapshot) }
        return Timeline(entries: [current] + later, policy: .atEnd)
    }

    private func entry(for configuration: UsageWidgetIntent, at date: Date) -> UsageEntry {
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
    @Environment(\.widgetFamily) private var family
    @Environment(\.locale) private var locale

    var body: some View {
        content.containerBackground(.background, for: .widget)
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
            ForEach(weeklies) { UsageBarRow(row: $0) }
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
                    ForEach(weeklies) { UsageBarRow(row: $0) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func header(_ machine: UsageWidgetMachine) -> some View {
        HStack(alignment: .firstTextBaseline) {
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
        let providers = snapshot.providers.filter { $0.windows.contains { $0.kind == kind } }
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

    /// The provider's name for "Weekly", which every weekly row would repeat, and name plus model for "Weekly · Opus".
    private func title(provider: String, label: String) -> String {
        let model = label.hasPrefix("Weekly · ") ? String(label.dropFirst("Weekly · ".count)) : nil
        return [provider.capitalized, model].compactMap { $0 }.joined(separator: " · ")
    }

    private func todayCost(_ snapshot: UsageWidgetSnapshot) -> String? {
        guard let cost = snapshot.cost, cost.day == UsageWidgetSnapshot.day(of: entry.date) else { return nil }
        return UsageMoneyFormatter(locale: locale, rate: cost.rate).string(usd: cost.usd)
    }
}

private func usageTint(_ used: Double) -> Color { used >= 0.9 ? .red : .primary }

private func usagePercent(_ used: Double) -> Text {
    Text(used, format: .percent.precision(.fractionLength(0)))
}

private struct UsageBarRow: View {
    let row: UsageRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                ProviderMark(provider: row.provider, size: 12)
                Text(row.title).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                usagePercent(row.used).fontWeight(.semibold).monospacedDigit()
            }
            .font(.caption)
            ProgressView(value: min(max(row.used, 0), 1)).tint(usageTint(row.used))
        }
        .accessibilityElement(children: .combine)
    }
}

private struct UsageRing: View {
    let row: UsageRow

    var body: some View {
        ZStack {
            Circle().stroke(.quaternary, lineWidth: 7)
            Circle()
                .trim(from: 0, to: min(max(row.used, 0), 1))
                .stroke(usageTint(row.used), style: StrokeStyle(lineWidth: 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                usagePercent(row.used).font(.headline).monospacedDigit()
                Text(row.label).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 10)
        }
        .frame(width: 68, height: 68)
        .accessibilityElement(children: .combine)
    }
}

/// The provider's word mark from the desktop's `ProviderLogo`, drawn in the text color like every other glyph here.
private struct ProviderMark: View {
    let provider: String
    let size: CGFloat

    var body: some View {
        Image(provider == "codex" ? "CodexMark" : "ClaudeMark")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .foregroundStyle(.primary)
            .accessibilityLabel(provider.capitalized)
    }
}
