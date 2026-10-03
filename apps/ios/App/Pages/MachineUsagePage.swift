import Charts
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// A machine the usage page can switch to from its title.
struct UsageMachine: Identifiable {
    let id: String
    let name: String
    let client: any MachineRequesting
}

/// The desktop's usage page: a period, money or tokens, a bar per day stacked per CLI with the six tiles under it,
/// the breakdown per model, project or day, then the plan limits and where the numbers came from.
struct MachineUsagePage: View {
    @State private var client: any MachineRequesting
    @State private var machineName: String?
    let machines: [UsageMachine]
    @State private var state = RemotePageState()
    @State private var limits: JSONValue?
    @State private var accounts: ProviderAccountList?
    /// Per CLI, what the machine types to log in under an account; a CLI without one has no login to offer.
    @State private var loginCommands: [String: String] = [:]
    @State private var login: UsageLogin?
    @State private var breakdown = UsageBreakdown.models
    @State private var selected: Date?
    @AppStorage("ruimte.ios.usage.period") private var period = UsagePeriod.week
    /// Empty until a person picks one, so the region decides until then.
    @AppStorage("ruimte.ios.usage.metric") private var chosenMetric = ""
    @Environment(\.locale) private var locale

    init(client: any MachineRequesting, machineName: String? = nil, machines: [UsageMachine] = []) {
        _client = State(initialValue: client)
        _machineName = State(initialValue: machineName)
        self.machines = machines
    }

    private var metric: UsageMetric { UsageMetric(rawValue: chosenMetric) ?? .preferred(locale) }
    private var report: UsageReport? { state.value.map { UsageReport($0) } }
    private var money: UsageMoneyFormatter {
        UsageMoneyFormatter(locale: locale, rate: state.value?["rate"], currency: metric.currency ?? "USD")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Period", selection: $period) {
                    ForEach(UsagePeriod.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                RemotePageStatus(state: state) { Task { await load() } }
                if let report {
                    headline(report)
                    chart(report)
                    tiles(report)
                    breakdownCard(report)
                }
                limitCards
                provenance
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(MobileStyle.canvas)
        .navigationTitle("Usage")
        .navigationSubtitle(machineName ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .modifier(UsageMachineMenu(machines: machines, pick: switchTo))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load() }
                } label: {
                    Image(lucide: "refresh-cw").accessibilityLabel("Scan again")
                }
                .disabled(state.loading)
            }
        }
        .refreshable { await load() }
        .mobileSheet(item: $login) { login in
            AccountLoginSheet(client: client, kind: login.kind, accountID: login.accountID, name: login.name)
        }
        .task(id: "\(period.rawValue) \(machineName ?? "")") {
            let client = client
            await RemotePageLifecycle.run(
                client: client, events: ["usage.changed", "usage.limitsChanged", "accounts.changed"],
                subscription: {
                    client.acquireSubscription(
                        start: "usage.subscribe", stop: "usage.unsubscribe", payload: .object([:]),
                        stopPayload: .object([:]))
                }, load: load)
        }
    }

    private func switchTo(_ machine: UsageMachine) {
        guard machine.name != machineName else { return }
        client = machine.client
        machineName = machine.name
        state = RemotePageState()
        limits = nil
        accounts = nil
        selected = nil
    }

    private func format(_ value: Double) -> String {
        metric == .tokens ? UsageReport.tokens(value) : money.string(amount: value)
    }

    /// A chart value in what the page counts in: tokens, or money in the page's currency.
    private func value(_ amount: UsageAmount) -> Double {
        metric == .tokens ? amount.tokens.total : money.amount(usd: amount.costUsd)
    }

    private func headline(_ report: UsageReport) -> some View {
        HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(format(value(report.total)))
                    .font(.largeTitle.weight(.bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                Text(
                    "\(Int(report.sessions).formatted()) sessions · \(Int(report.total.tokens.calls).formatted()) calls · at API rates"
                )
                .font(.caption).foregroundStyle(MobileStyle.muted)
            }
            Spacer(minLength: 8)
            Picker("Count in", selection: Binding(get: { metric }, set: { chosenMetric = $0.rawValue })) {
                ForEach(UsageMetric.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .fixedSize()
        }
    }

    private func chart(_ report: UsageReport) -> some View {
        let unit: Calendar.Component = report.hourly ? .hour : .day
        let focus = selected.flatMap { date in report.slots.first { Self.same(date, $0.date, unit: unit) } }
        return VStack(alignment: .leading, spacing: 10) {
            Chart {
                ForEach(report.slots) { slot in
                    ForEach(report.stacked, id: \.self) { provider in
                        BarMark(
                            x: .value("Slot", slot.date, unit: unit),
                            y: .value("Amount", slot.byProvider[provider].map(value) ?? 0)
                        )
                        .foregroundStyle(by: .value("CLI", usageProviderName(provider)))
                        .opacity(focus == nil || focus?.id == slot.id ? 1 : 0.45)
                    }
                }
                if let focus {
                    RuleMark(x: .value("Slot", focus.date, unit: unit))
                        .foregroundStyle(.clear)
                        .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                            slotDetail(focus, report: report)
                        }
                }
            }
            .chartForegroundStyleScale(
                domain: report.stacked.map(usageProviderName), range: report.stacked.map(Self.color))
            .chartLegend(.hidden)
            .chartXSelection(value: $selected)
            .chartYAxis {
                AxisMarks { mark in
                    AxisGridLine()
                    AxisValueLabel {
                        if let amount = mark.as(Double.self) { Text(format(amount)) }
                    }
                }
            }
            .frame(height: 170)
            .accessibilityLabel(metric == .tokens ? (unit == .hour ? "Tokens per hour" : "Tokens per day") : "Cost per day")
            HStack(spacing: 16) {
                ForEach(report.providers) { provider in
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 2).fill(Self.color(provider.provider)).frame(width: 8, height: 8)
                        Text(usageProviderName(provider.provider))
                        Text(format(value(provider.amount))).foregroundStyle(MobileStyle.muted).monospacedDigit()
                    }
                    .font(.caption)
                }
            }
        }
        .modifier(UsageCard())
    }

    private func slotDetail(_ slot: UsageReport.Slot, report: UsageReport) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(report.hourly ? slot.date.formatted(date: .omitted, time: .shortened) : slot.date.formatted(.dateTime.weekday(.wide).day().month()))
                .font(.caption.weight(.semibold))
            ForEach(report.stacked, id: \.self) { provider in
                HStack(spacing: 4) {
                    Circle().fill(Self.color(provider)).frame(width: 6, height: 6)
                    Text("\(usageProviderName(provider)) \(format(slot.byProvider[provider].map(value) ?? 0))")
                }
                .font(.caption2).monospacedDigit()
            }
        }
        .padding(8)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))
    }

    private func tiles(_ report: UsageReport) -> some View {
        let tokens = report.total.tokens
        let tiles: [(String, String)] = [
            (String(localized: "Processed", comment: "Tokens processed"), UsageReport.tokens(tokens.total)),
            (String(localized: "Uncached", comment: "Input tokens read without a cache"), UsageReport.tokens(tokens.input)),
            (String(localized: "Cached", comment: "Input tokens read from a cache"), UsageReport.tokens(tokens.cacheRead)),
            (String(localized: "Cache writes"), UsageReport.tokens(tokens.cacheWrite)),
            (String(localized: "Output", comment: "Output tokens"), UsageReport.tokens(tokens.output)),
            (String(localized: "Cache savings"), money.string(usd: report.cacheSavingsUsd)),
        ]
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(tiles, id: \.0) { tile in
                VStack(alignment: .leading, spacing: 2) {
                    Text(tile.0).font(.caption2).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    Text(tile.1).font(.callout.weight(.semibold)).monospacedDigit().lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func breakdownCard(_ report: UsageReport) -> some View {
        let rows = report.rows(breakdown, metric: metric)
        let top = rows.map { $0.value(metric) }.max() ?? 0
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Breakdown").font(.headline)
                Spacer()
                Picker("Breakdown", selection: $breakdown) {
                    ForEach(UsageBreakdown.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .fixedSize()
            }
            if rows.isEmpty {
                Text("No usage in this period.").font(.callout).foregroundStyle(MobileStyle.muted)
            }
            ForEach(rows) { row in
                breakdownRow(row, report: report, top: top)
            }
            if report.unpriced && breakdown == .models {
                Text("Some models have no known price and are left out of the cost.")
                    .font(.caption).foregroundStyle(MobileStyle.muted)
            }
        }
        .modifier(UsageCard())
    }

    private func breakdownRow(_ row: UsageReport.Row, report: UsageReport, top: Double) -> some View {
        let amount = metric == .tokens ? UsageReport.tokens(row.tokens) : row.costUsd.map { money.string(usd: $0) } ?? String(localized: "No price")
        let share = report.share(row, metric: metric)
        let title = breakdown == .day ? (UsageReport.date(row.title)?.formatted(.dateTime.weekday(.abbreviated).day().month()) ?? row.title) : row.title
        var detail = breakdown == .projects ? row.detail : String(localized: "\(Int(row.calls).formatted()) calls")
        if let share { detail += " · \(share.formatted(.percent.precision(.fractionLength(0))))" }
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                if let provider = row.provider {
                    Circle().fill(Self.color(provider)).frame(width: 7, height: 7).accessibilityHidden(true)
                }
                Text(title).font(.callout).lineLimit(1)
                Spacer(minLength: 8)
                Text(amount).font(.callout).monospacedDigit()
            }
            Text(detail).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1).truncationMode(.middle)
            ShareBar(fraction: top > 0 ? row.value(metric) / top : 0, color: row.provider.map(Self.color) ?? MobileStyle.accent)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var limitCards: some View {
        let sections = UsageLimitSection.sections(limits: limits, accounts: accounts)
        if !sections.isEmpty {
            Text("Limits").font(.headline).padding(.top, 6)
        }
        ForEach(sections) { section in
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    if section.named { AccountDot(color: section.color) }
                    Text(section.named ? "\(usageProviderName(section.kind)) · \(section.name)" : usageProviderName(section.kind))
                        .font(.callout.weight(.semibold))
                    Spacer()
                    if let plan = section.entry?["plan"]?.stringValue {
                        Text(plan.capitalized).font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
                limitRows(section)
            }
            .modifier(UsageCard())
        }
    }

    @ViewBuilder private func limitRows(_ section: UsageLimitSection) -> some View {
        switch section.quiet {
        case .signedOut:
            if loginCommands[section.kind] != nil {
                Text("Not logged in. Log in to see its limits.").font(.callout).foregroundStyle(MobileStyle.muted)
                Button(String(localized: "Log in"), lucideIcon: "log-in") {
                    login = UsageLogin(kind: section.kind, accountID: section.id, name: section.name)
                }
                .buttonStyle(.bordered)
            } else {
                Text("Not logged in. Log in on the machine to see its limits.").font(.callout)
                    .foregroundStyle(MobileStyle.muted)
            }
        case .notRead(let message):
            Text(message ?? String(localized: "Not read yet. Its limits appear once the machine has read them."))
                .font(.callout).foregroundStyle(MobileStyle.muted)
        case nil:
            if let provider = section.entry {
                if let unavailable = provider["unavailable"], unavailable != .null {
                    Text(unavailable.text("message", fallback: unavailable.text("reason"))).font(.callout)
                        .foregroundStyle(MobileStyle.muted)
                }
                ForEach(provider.list("windows"), id: \.stableID) { window in
                    LimitBar(
                        label: window.text("label"), used: window.number("used"),
                        resetsAt: window["resetsAt"]?.numberValue.map { Date(timeIntervalSince1970: $0 / 1000) })
                }
            }
        }
    }

    @ViewBuilder private var provenance: some View {
        if let summary = state.value {
            let scan = summary["scan"]
            let scanned = Date(timeIntervalSince1970: (scan?.number("at") ?? 0) / 1000)
            let files = Int(scan?.number("files") ?? 0)
            let prices = summary["pricing"]?["fetchedAt"]?.numberValue.map {
                String(localized: "Prices from LiteLLM, \(Date(timeIntervalSince1970: $0 / 1000).formatted(.dateTime.day().month()))")
            } ?? String(localized: "Bundled prices")
            let rate =
                money.currencyCode == "EUR"
                ? money.rateDate.flatMap { UsageReport.date($0) }.map {
                    String(localized: " · EUR at the ECB rate of \($0.formatted(.dateTime.day().month()))", comment: "Appended to the usage provenance line; %@ is a date")
                } ?? "" : ""
            VStack(spacing: 6) {
                if scan?["failed"]?.boolValue == true {
                    Text("The latest scan failed. These are the last totals.").foregroundStyle(MobileStyle.statusNeedsYou)
                }
                if metric == .euro, let explanation = money.explanation, money.currencyCode == "USD" {
                    Text(explanation)
                }
                Text(
                    "Scanned \(scanned.formatted(date: .omitted, time: .shortened)), \(files.formatted()) files · \(prices)\(rate)",
                    comment: "A time, a file count, where the prices came from, then an optional currency note"
                )
            }
            .font(.caption).foregroundStyle(MobileStyle.muted).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
        }
    }

    static func color(_ provider: String) -> Color {
        switch provider {
        case "claude": MobileStyle.chartClaude
        case "codex": MobileStyle.chartCodex
        default: MobileStyle.muted
        }
    }

    private static func same(_ left: Date, _ right: Date, unit: Calendar.Component) -> Bool {
        Calendar.current.isDate(left, equalTo: right, toGranularity: unit)
    }

    private func load() async {
        let client = client
        let period = period
        await state.load {
            let result = try await client.request(WireRequest.usageSummary.rawValue, payload: period.payload())
            limits = try? await client.request(WireRequest.usageLimits.rawValue)
            // A machine from before accounts does not know the request, and its limits read as they always did.
            let list = try? await client.request(WireRequest.accountsList.rawValue)
            accounts = list.map(ProviderAccountList.init)
            loginCommands = (list?["loginCommands"]?.objectValue ?? [:]).compactMapValues(\.stringValue)
            return result
        }
    }
}

/// A plan window, amber once it comes close to its limit.
struct LimitBar: View {
    let label: String
    let used: Double
    let resetsAt: Date?

    private var close: Bool { used >= 0.8 }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label)
                Spacer()
                Group {
                    if let resetsAt {
                        Text("\(used.formatted(.percent.precision(.fractionLength(0)))) · resets \(LimitBar.reset(resetsAt))")
                    } else {
                        Text(used.formatted(.percent.precision(.fractionLength(0))))
                    }
                }
                .foregroundStyle(close ? MobileStyle.statusNeedsYou : MobileStyle.muted)
                .monospacedDigit()
            }
            .font(.footnote)
            ShareBar(fraction: used, color: close ? MobileStyle.statusNeedsYou : MobileStyle.text)
        }
        .accessibilityElement(children: .combine)
    }

    /// A reset today is a time, one within the week a weekday, anything later a date.
    static func reset(_ date: Date, now: Date = Date()) -> String {
        if Calendar.current.isDate(date, inSameDayAs: now) { return date.formatted(date: .omitted, time: .shortened) }
        if date.timeIntervalSince(now) < 6 * 86_400 { return date.formatted(.dateTime.weekday(.abbreviated)) }
        return date.formatted(.dateTime.day().month())
    }
}

/// A thin bar of a share, on the faint track every bar of the page shares.
struct ShareBar: View {
    let fraction: Double
    let color: Color

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(MobileStyle.border)
                Capsule().fill(color).frame(width: proxy.size.width * min(1, max(0, fraction)))
            }
        }
        .frame(height: 5)
        .accessibilityHidden(true)
    }
}

/// The opaque card the usage and machine pages put their groups on.
struct UsageCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// The machines in the title, only where there is more than one: an empty title menu would still draw its chevron.
private struct UsageMachineMenu: ViewModifier {
    let machines: [UsageMachine]
    let pick: (UsageMachine) -> Void

    func body(content: Content) -> some View {
        if machines.count > 1 {
            content.toolbarTitleMenu {
                ForEach(machines) { machine in
                    Button(machine.name) { pick(machine) }
                }
            }
        } else {
            content
        }
    }
}

/// A signed-out account a person asked to log in to.
private struct UsageLogin: Identifiable {
    let kind: String
    let accountID: String
    let name: String

    var id: String { accountID }
}
