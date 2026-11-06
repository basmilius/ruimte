import Foundation

/// One bar or ring of a usage widget.
public struct UsageWidgetRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let provider: String
    public let label: String
    public let title: String
    public let used: Double
}

extension UsageWidgetSnapshot {
    /// How many accounts of a CLI the machine reported, which is when a row names its account.
    public func accountCount(_ kind: String) -> Int { providers.filter { $0.kind == kind }.count }

    /// One account per CLI, of every CLI or of `provider` alone: `account` for the CLI it belongs to, the default
    /// account for any other. The default account comes first when the machine names none.
    public func shown(provider: String?, account: String?) -> [Provider] {
        var kinds: [String] = []
        for reported in providers where provider == nil || reported.kind == provider {
            if !kinds.contains(reported.kind) { kinds.append(reported.kind) }
        }
        return kinds.compactMap { kind in
            let own = providers.filter { $0.kind == kind }
            return own.first { $0.accountID == account } ?? own.first { $0.accountID == kind } ?? own.first
        }
    }

    /// The windows of one kind, shared evenly between the CLIs that report one. Past its reset a window starts over,
    /// which the app has not heard yet, so it reads as unused.
    public func rows(kind: String, limit: Int, provider: String?, account: String?, at date: Date) -> [UsageWidgetRow] {
        let reporting = shown(provider: provider, account: account).filter { shown in
            shown.windows.contains { $0.kind == kind }
        }
        let each = max(1, limit / max(1, reporting.count))
        let rows = reporting.flatMap { reported in
            reported.windows.filter { $0.kind == kind }.prefix(each).map { window in
                let reset = window.resetsAt.map { $0 <= date } ?? false
                return UsageWidgetRow(
                    id: "\(reported.kind):\(reported.accountID):\(window.label)", provider: reported.kind,
                    label: window.label, title: title(reported, label: window.label, alone: provider != nil),
                    used: reset ? 0 : window.used)
            }
        }
        return Array(rows.prefix(limit))
    }

    /// Today's cost of what a widget shows: the machine over every CLI, one CLI, or one account of a CLI with several.
    /// Nil once the day the cost is of has passed.
    public func todayUSD(provider: String?, account: String?, at date: Date) -> Double? {
        guard let cost, cost.day == Self.day(of: date) else { return nil }
        guard let provider else { return cost.usd }
        if accountCount(provider) > 1, let byAccount = cost.usdByAccount,
            let shown = shown(provider: provider, account: account).first
        {
            return byAccount[shown.accountID] ?? 0
        }
        return cost.usdByProvider.map { $0[provider] ?? 0 }
    }

    /// "Weekly · Opus" reads as the model alone. Over every CLI the CLI's name stands in for "Weekly", which every
    /// weekly row would repeat; in one CLI's widget the header already names it. A CLI with several accounts names the
    /// account too.
    private func title(_ reported: Provider, label: String, alone: Bool) -> String {
        let model = label.hasPrefix("Weekly · ") ? String(label.dropFirst("Weekly · ".count)) : nil
        let account = accountCount(reported.kind) > 1 ? reported.account?.label : nil
        if alone { return [account, model ?? label].compactMap { $0 }.joined(separator: " · ") }
        return [usageProviderName(reported.kind), account, model].compactMap { $0 }.joined(separator: " · ")
    }
}

/// The name of a CLI whose limits a machine reads, for a machine that sends no name of its own.
public func usageProviderName(_ kind: String) -> String { kind.capitalized }
