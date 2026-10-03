import Foundation
import RuimtePulsar

enum UsagePeriod: String, CaseIterable, Identifiable, Sendable {
    case today, week, month, quarter

    var id: Self { self }
    var days: Int {
        switch self {
        case .today: 1
        case .week: 7
        case .month: 30
        case .quarter: 90
        }
    }
    var label: String {
        switch self {
        case .today: String(localized: "Today")
        case .week: String(localized: "7 days")
        case .month: String(localized: "30 days")
        case .quarter: String(localized: "90 days")
        }
    }

    /// What `usage.summary` is asked. Today counts from local midnight per hour; every other period per calendar day.
    func payload(now: Date = Date(), calendar: Calendar = .current) -> JSONValue {
        let from = calendar.date(byAdding: .day, value: -(days - 1), to: now) ?? now
        return .object([
            "from": .string(UsageReport.day(from, calendar: calendar)),
            "to": .string(UsageReport.day(now, calendar: calendar)),
            "resolution": .string(self == .today ? "hour" : "day"),
            "timeZone": .string(calendar.timeZone.identifier),
        ])
    }
}

/// What the page counts in: the money of a currency, or tokens.
enum UsageMetric: String, CaseIterable, Identifiable, Sendable {
    case euro, dollar, tokens

    var id: Self { self }
    var label: String {
        switch self {
        case .euro: "€"
        case .dollar: "$"
        case .tokens: String(localized: "Tokens")
        }
    }
    var currency: String? {
        switch self {
        case .euro: "EUR"
        case .dollar: "USD"
        case .tokens: nil
        }
    }

    static func preferred(_ locale: Locale) -> UsageMetric { locale.currency?.identifier == "EUR" ? .euro : .dollar }
}

/// Token kinds are disjoint, so a total is their sum; reasoning is a part of output and never counted twice.
struct UsageTokens: Equatable, Sendable {
    var calls = 0.0
    var input = 0.0
    var cacheRead = 0.0
    var cacheWrite = 0.0
    var output = 0.0

    init() {}

    init(_ value: JSONValue?) {
        calls = value?.number("calls") ?? 0
        input = value?.number("input") ?? 0
        cacheRead = value?.number("cacheRead") ?? 0
        cacheWrite = value?.number("cacheWrite") ?? 0
        output = value?.number("output") ?? 0
    }

    var total: Double { input + cacheRead + cacheWrite + output }

    static func + (left: UsageTokens, right: UsageTokens) -> UsageTokens {
        var sum = left
        sum.calls += right.calls
        sum.input += right.input
        sum.cacheRead += right.cacheRead
        sum.cacheWrite += right.cacheWrite
        sum.output += right.output
        return sum
    }
}

struct UsageAmount: Equatable, Sendable {
    var costUsd = 0.0
    var tokens = UsageTokens()

    func value(_ metric: UsageMetric) -> Double { metric == .tokens ? tokens.total : costUsd }
}

/// The buckets of one `usage.summary` folded into what the page draws: a bar per slot stacked per CLI, a total per
/// CLI, the tiles and the three breakdowns. Prices are in dollars; a page in euros converts at the bank's rate.
struct UsageReport: Equatable, Sendable {
    struct Slot: Identifiable, Equatable, Sendable {
        /// `YYYY-MM-DD`, or `YYYY-MM-DDTHH` for an hour of today.
        let id: String
        let date: Date
        var byProvider: [String: UsageAmount]

        func value(_ metric: UsageMetric) -> Double { byProvider.values.reduce(0) { $0 + $1.value(metric) } }
    }

    struct ProviderTotal: Identifiable, Equatable, Sendable {
        let provider: String
        var amount: UsageAmount
        var id: String { provider }
    }

    struct Row: Identifiable, Equatable, Sendable {
        let id: String
        let title: String
        let detail: String
        let provider: String?
        /// Nil for a model without a known price, which is not the same as free.
        let costUsd: Double?
        let tokens: Double
        let calls: Double

        func value(_ metric: UsageMetric) -> Double { metric == .tokens ? tokens : costUsd ?? 0 }
    }

    let hourly: Bool
    let slots: [Slot]
    /// Every CLI that did anything, dearest first.
    let providers: [ProviderTotal]
    let total: UsageAmount
    let cacheSavingsUsd: Double
    let sessions: Double
    let models: [Row]
    let projects: [Row]
    let days: [Row]
    /// Whether some model had no price, which leaves it out of every cost.
    let unpriced: Bool

    init(_ summary: JSONValue, calendar: Calendar = .current) {
        hourly = summary.text("resolution") == "hour"
        let keys = Self.slots(summary, calendar: calendar)
        var slots = keys.map { Slot(id: $0.0, date: $0.1, byProvider: [:]) }
        let index = Dictionary(uniqueKeysWithValues: slots.enumerated().map { ($1.id, $0) })
        var providers: [String: UsageAmount] = [:]
        var days: [String: (amount: UsageAmount, providers: Set<String>)] = [:]
        var total = UsageAmount()
        var savings = 0.0
        for bucket in summary.list("buckets") {
            let provider = bucket.text("provider")
            let amount = UsageAmount(costUsd: bucket["costUsd"]?.numberValue ?? 0, tokens: UsageTokens(bucket["totals"]))
            let slot = bucket.text("slot")
            if let position = index[String(slot.prefix(hourly ? 13 : 10))] {
                slots[position].byProvider[provider, default: UsageAmount()].add(amount)
            }
            providers[provider, default: UsageAmount()].add(amount)
            let day = String(slot.prefix(10))
            days[day, default: (UsageAmount(), [])].amount.add(amount)
            days[day]?.providers.insert(provider)
            total.add(amount)
            savings += bucket.number("cacheSavingsUsd")
        }
        self.slots = slots
        self.providers = providers.map { ProviderTotal(provider: $0.key, amount: $0.value) }
            .sorted { ($0.amount.costUsd, $1.provider) > ($1.amount.costUsd, $0.provider) }
        self.total = total
        cacheSavingsUsd = savings
        sessions = summary.number("sessions")
        let models = summary.list("models")
        unpriced = models.contains { $0["costUsd"] == .null }
        self.models = models.map { model in
            let tokens = UsageTokens(model["totals"])
            return Row(
                id: "\(model.text("provider")) \(model.text("model")) \(model.text("account"))",
                title: ModelName.fromSlug(model.text("model")), detail: usageProviderName(model.text("provider")),
                provider: model.text("provider"), costUsd: model["costUsd"]?.numberValue, tokens: tokens.total,
                calls: tokens.calls)
        }
        projects = summary.list("projects").map { project in
            let tokens = UsageTokens(project["totals"])
            return Row(
                id: project.text("folder"), title: project.text("name", fallback: project.text("folder")),
                detail: Self.shortPath(project.text("folder")), provider: nil, costUsd: project.number("costUsd"),
                tokens: tokens.total, calls: tokens.calls)
        }
        self.days = days.sorted { $0.key > $1.key }.map { day in
            Row(
                id: day.key, title: day.key, detail: day.value.providers.sorted().map(usageProviderName).joined(separator: ", "),
                provider: nil, costUsd: day.value.amount.costUsd, tokens: day.value.amount.tokens.total,
                calls: day.value.amount.tokens.calls)
        }
    }

    /// The CLIs that did anything, in the order the chart stacks them.
    var stacked: [String] { providers.map(\.provider).sorted() }

    /// The rows of a breakdown, biggest first in what the page counts.
    func rows(_ breakdown: UsageBreakdown, metric: UsageMetric) -> [Row] {
        switch breakdown {
        case .models: models.sorted { $0.value(metric) > $1.value(metric) }
        case .projects: projects.sorted { $0.value(metric) > $1.value(metric) }
        case .day: days
        }
    }

    /// A row's part of the period, nil where the total says nothing.
    func share(_ row: Row, metric: UsageMetric) -> Double? {
        let whole = total.value(metric)
        guard whole > 0, metric == .tokens || row.costUsd != nil else { return nil }
        return row.value(metric) / whole
    }

    /// Every slot of the period, whether anything happened in it or not, so a quiet day keeps its place on the axis.
    private static func slots(_ summary: JSONValue, calendar: Calendar) -> [(String, Date)] {
        guard let from = date(summary.text("from"), calendar: calendar), let to = date(summary.text("to"), calendar: calendar)
        else { return [] }
        if summary.text("resolution") == "hour" {
            return (0..<24).compactMap { hour in
                calendar.date(byAdding: .hour, value: hour, to: to).map {
                    ("\(summary.text("to"))T\(String(format: "%02d", hour))", $0)
                }
            }
        }
        var slots: [(String, Date)] = []
        var at = from
        while at <= to && slots.count < 400 {
            slots.append((day(at, calendar: calendar), at))
            guard let next = calendar.date(byAdding: .day, value: 1, to: at) else { break }
            at = next
        }
        return slots
    }

    static func day(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func date(_ day: String, calendar: Calendar = .current) -> Date? {
        let parts = day.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// Enough of the tail of a folder to tell two checkouts apart, without the home folder.
    static func shortPath(_ path: String) -> String {
        let parts = path.split(separator: "/")
        return parts.count <= 3 ? path : "…/" + parts.suffix(3).joined(separator: "/")
    }

    /// Tokens as a person reads them at a glance: 48.2M, 3.1K.
    static func tokens(_ value: Double) -> String {
        value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
    }
}

enum UsageBreakdown: String, CaseIterable, Identifiable, Sendable {
    case models, projects, day

    var id: Self { self }
    var label: String {
        switch self {
        case .models: String(localized: "Models")
        case .projects: String(localized: "Projects")
        case .day: String(localized: "Day")
        }
    }
}

extension UsageAmount {
    mutating func add(_ other: UsageAmount) {
        costUsd += other.costUsd
        tokens = tokens + other.tokens
    }
}
