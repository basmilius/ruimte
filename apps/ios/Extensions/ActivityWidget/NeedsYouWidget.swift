import LucideSwift
import RuimtePulsar
import SwiftUI
import WidgetKit

/// How many nodes wait on you over every machine, beside how many work.
struct NeedsYouCountWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: NeedsYouWidgetStore.countKind, provider: NeedsYouTimeline()) { entry in
            NeedsYouCountView(entry: entry)
        }
        .configurationDisplayName("Needs you")
        .description("How many agents wait for you, and how many are working.")
        .supportedFamilies([.systemSmall])
    }
}

/// What waits on you, each row opening its chat or terminal.
struct NeedsYouListWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: NeedsYouWidgetStore.listKind, provider: NeedsYouTimeline()) { entry in
            NeedsYouListView(entry: entry)
        }
        .configurationDisplayName("Needs you list")
        .description("The agents that wait for you. Tap one to open it.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct NeedsYouEntry: TimelineEntry {
    let date: Date
    /// Nil until the app has written one.
    let snapshot: NeedsYouWidgetSnapshot?

    static var sample: NeedsYouEntry {
        NeedsYouEntry(
            date: .now,
            snapshot: NeedsYouWidgetSnapshot(
                items: [
                    NeedsYouWidgetItem(
                        machineID: "sample", projectID: "recipes", nodeID: "a", target: "chat",
                        title: "Refactor reconnect loop", projectName: "Recept Maker", detail: "Edit pool.ts"),
                    NeedsYouWidgetItem(
                        machineID: "sample", projectID: "portfolio", nodeID: "b", target: "chat",
                        title: "Case study draft", projectName: "Portfolio", detail: "Asks a question"),
                ], working: 3))
    }
}

/// Only the app knows when something changes, and it reloads the widgets when it writes.
struct NeedsYouTimeline: TimelineProvider {
    func placeholder(in context: Context) -> NeedsYouEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (NeedsYouEntry) -> Void) {
        let snapshot = NeedsYouWidgetStore.snapshot()
        completion(context.isPreview && snapshot == nil ? .sample : NeedsYouEntry(date: .now, snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NeedsYouEntry>) -> Void) {
        completion(
            Timeline(entries: [NeedsYouEntry(date: .now, snapshot: NeedsYouWidgetStore.snapshot())], policy: .never))
    }
}

private struct NeedsYouColors {
    let scheme: ColorScheme

    func color(_ token: RuimteColorToken) -> Color { RuimteColorToken.color(scheme == .dark ? token.dark : token.light) }
    var needsYou: Color { color(RuimteColors.statusNeedsYou) }
    var working: Color { color(RuimteColors.statusRunning) }
    var muted: Color { color(RuimteColors.muted) }
    var ground: Color { color(RuimteColors.surface) }
}

private struct NeedsYouCountView: View {
    let entry: NeedsYouEntry
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let colors = NeedsYouColors(scheme: scheme)
        let count = entry.snapshot?.items.count ?? 0
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                LucideIcon(.inbox, size: 14)
                Text("Now").font(.caption.weight(.semibold))
            }
            .foregroundStyle(colors.muted)
            Spacer(minLength: 0)
            if entry.snapshot == nil {
                Text("Open Ruimte to see what waits for you.").font(.caption).foregroundStyle(colors.muted)
            } else {
                Text("\(count)").font(.system(size: 44, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(count > 0 ? colors.needsYou : colors.muted)
                Text(count == 1 ? "needs you" : "need you").font(.subheadline.weight(.medium))
                if let working = entry.snapshot?.working, working > 0 {
                    HStack(spacing: 5) {
                        Circle().fill(colors.working).frame(width: 6, height: 6)
                        Text("\(working) working").font(.caption).foregroundStyle(colors.muted)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .widgetURL(NeedsYouWidgetSnapshot.nowURL)
        .containerBackground(colors.ground, for: .widget)
    }
}

private struct NeedsYouListView: View {
    let entry: NeedsYouEntry
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let colors = NeedsYouColors(scheme: scheme)
        let items = entry.snapshot?.items ?? []
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(colors.needsYou).frame(width: 6, height: 6)
                Text("Needs you").font(.caption.weight(.semibold))
                Text("\(items.count)").font(.caption.weight(.semibold)).monospacedDigit()
                Spacer(minLength: 4)
                if let projects = entry.snapshot?.projects, projects > 0 {
                    Text("\(projects) projects").font(.caption)
                }
            }
            .foregroundStyle(colors.muted)
            if entry.snapshot == nil {
                message(String(localized: "Open Ruimte to see what waits for you."), colors: colors)
            } else if items.isEmpty {
                message(String(localized: "Nothing needs you."), colors: colors)
            } else {
                ForEach(items.prefix(family == .systemLarge ? 6 : 2)) { item in
                    Link(destination: item.url ?? NeedsYouWidgetSnapshot.nowURL) { row(item, colors: colors) }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(NeedsYouWidgetSnapshot.nowURL)
        .containerBackground(colors.ground, for: .widget)
    }

    private func row(_ item: NeedsYouWidgetItem, colors: NeedsYouColors) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 4)
                Text(item.projectName).font(.caption).foregroundStyle(colors.muted).lineLimit(1)
            }
            Text(item.detail).font(.caption).foregroundStyle(colors.needsYou).lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }

    private func message(_ text: String, colors: NeedsYouColors) -> some View {
        Text(text).font(.caption).foregroundStyle(colors.muted)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
