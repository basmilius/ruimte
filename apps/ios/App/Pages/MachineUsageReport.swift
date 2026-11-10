import Foundation
import RuimtePulsar
import RuimteShared

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

    init(_ totals: UsageTotals) {
        calls = Double(totals.calls)
        input = Double(totals.input)
        cacheRead = Double(totals.cacheRead)
        cacheWrite = Double(totals.cacheWrite)
        output = Double(totals.output)
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

    mutating func add(_ other: UsageAmount) {
        costUsd += other.costUsd
        tokens = tokens + other.tokens
    }
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
    let providers: [ProviderTotal]
    let total: UsageAmount
    let cacheSavingsUsd: Double
    let sessions: Double
    let models: [Row]
    let projects: [Row]
    let days: [Row]
    /// Whether some model had no price, which leaves it out of every cost.
    let unpriced: Bool

    init(_ summary: UsageSummary, calendar: Calendar = .current) {
        hourly = summary.resolution == .hour
        let keys = Self.slots(summary, calendar: calendar)
        var slots = keys.map { Slot(id: $0.0, date: $0.1, byProvider: [:]) }
        let index = Dictionary(uniqueKeysWithValues: slots.enumerated().map { ($1.id, $0) })
        var providers: [String: UsageAmount] = [:]
        var days: [String: (amount: UsageAmount, providers: Set<String>)] = [:]
        var total = UsageAmount()
        var savings = 0.0
        for bucket in summary.buckets {
            let provider = bucket.provider
            let amount = UsageAmount(costUsd: bucket.costUsd ?? 0, tokens: UsageTokens(bucket.totals))
            let slot = bucket.slot
            if let position = index[String(slot.prefix(hourly ? 13 : 10))] {
                slots[position].byProvider[provider, default: UsageAmount()].add(amount)
            }
            providers[provider, default: UsageAmount()].add(amount)
            let day = String(slot.prefix(10))
            days[day, default: (UsageAmount(), [])].amount.add(amount)
            days[day]?.providers.insert(provider)
            total.add(amount)
            savings += bucket.cacheSavingsUsd
        }
        self.slots = slots
        self.providers = providers.map { ProviderTotal(provider: $0.key, amount: $0.value) }
            .sorted { ($0.amount.costUsd, $1.provider) > ($1.amount.costUsd, $0.provider) }
        self.total = total
        cacheSavingsUsd = savings
        sessions = Double(summary.sessions)
        let models = summary.models
        unpriced = models.contains { $0.costUsd == nil }
        self.models = models.map { model in
            let tokens = UsageTokens(model.totals)
            return Row(
                id: "\(model.provider) \(model.model) \(model.account ?? "")",
                title: ModelName.fromSlug(model.model), detail: usageProviderName(model.provider),
                provider: model.provider, costUsd: model.costUsd, tokens: tokens.total, calls: tokens.calls)
        }
        projects = summary.projects.map { project in
            let tokens = UsageTokens(project.totals)
            return Row(
                id: project.folder, title: project.name, detail: Self.shortPath(project.folder), provider: nil,
                costUsd: project.costUsd, tokens: tokens.total, calls: tokens.calls)
        }
        self.days = days.sorted { $0.key > $1.key }.map { day in
            Row(
                id: day.key, title: day.key, detail: day.value.providers.sorted().map(usageProviderName).joined(separator: ", "),
                provider: nil, costUsd: day.value.amount.costUsd, tokens: day.value.amount.tokens.total,
                calls: day.value.amount.tokens.calls)
        }
    }

    var stacked: [String] { providers.map(\.provider).sorted() }

    func rows(_ breakdown: UsageBreakdown, metric: UsageMetric) -> [Row] {
        switch breakdown {
        case .models: models.sorted { $0.value(metric) > $1.value(metric) }
        case .projects: projects.sorted { $0.value(metric) > $1.value(metric) }
        case .day: days
        }
    }

    func share(_ row: Row, metric: UsageMetric) -> Double? {
        let whole = total.value(metric)
        guard whole > 0, metric == .tokens || row.costUsd != nil else { return nil }
        return row.value(metric) / whole
    }

    /// Every slot of the period, whether anything happened in it or not, so a quiet day keeps its place on the axis.
    private static func slots(_ summary: UsageSummary, calendar: Calendar) -> [(String, Date)] {
        guard let from = date(summary.from, calendar: calendar), let to = date(summary.to, calendar: calendar)
        else { return [] }
        if summary.resolution == .hour {
            return (0..<24).compactMap { hour in
                calendar.date(byAdding: .hour, value: hour, to: to).map {
                    ("\(summary.to)T\(String(format: "%02d", hour))", $0)
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

    static func shortPath(_ path: String) -> String {
        let parts = path.split(separator: "/")
        return parts.count <= 3 ? path : "…/" + parts.suffix(3).joined(separator: "/")
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
