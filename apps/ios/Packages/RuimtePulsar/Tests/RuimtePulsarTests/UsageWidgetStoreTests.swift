import Foundation
import Testing

@testable import RuimtePulsar

@Test func usageWidgetDayIsTheDayOfTheGivenTimeZone() throws {
    let late = Date(timeIntervalSince1970: 1_790_031_600)
    #expect(UsageWidgetSnapshot.day(of: late, in: try #require(TimeZone(identifier: "UTC"))) == "2026-09-21")
    #expect(
        UsageWidgetSnapshot.day(of: late, in: try #require(TimeZone(identifier: "Europe/Amsterdam"))) == "2026-09-22")
}

private let now = Date(timeIntervalSince1970: 1_790_000_000)

private func weekly(_ used: Double, label: String = "Weekly") -> UsageWidgetSnapshot.Window {
    .init(kind: "weekly", label: label, used: used, resetsAt: nil)
}

private let severalAccounts = UsageWidgetSnapshot(
    providers: [
        .init(kind: "claude", account: .init(id: "claude", label: "Personal"), windows: [weekly(0.2)]),
        .init(kind: "claude", account: .init(id: "work", label: "Work", color: "pink"), windows: [weekly(0.9)]),
        .init(kind: "codex", account: .init(id: "codex", label: "Codex"), windows: [weekly(0.5)]),
    ], updatedAt: now,
    cost: .init(
        day: UsageWidgetSnapshot.day(of: now), usd: 10, usdByProvider: ["claude": 8, "codex": 2],
        usdByAccount: ["claude": 3, "work": 5, "codex": 2], rate: nil, fetchedAt: now))

@Test func usageWidgetShowsTheDefaultAccountOfEachCLIUnlessOneIsPicked() {
    #expect(severalAccounts.shown(provider: nil, account: nil).map(\.accountID) == ["claude", "codex"])
    #expect(severalAccounts.shown(provider: nil, account: "work").map(\.accountID) == ["work", "codex"])
    #expect(severalAccounts.shown(provider: "claude", account: "work").map(\.accountID) == ["work"])
    #expect(severalAccounts.shown(provider: "codex", account: "work").map(\.accountID) == ["codex"])
    #expect(severalAccounts.shown(provider: "claude", account: "gone").map(\.accountID) == ["claude"])
}

@Test func usageWidgetRowsAreUniquePerAccountAndNameTheAccountOfACLIWithSeveral() {
    let every = severalAccounts.rows(kind: "weekly", limit: 3, provider: nil, account: "work", at: now)
    #expect(every.map(\.id) == ["claude:work:Weekly", "codex:codex:Weekly"])
    #expect(every.map(\.title) == ["Claude · Work", "Codex"])
    let claude = severalAccounts.rows(kind: "weekly", limit: 2, provider: "claude", account: nil, at: now)
    #expect(claude.map(\.title) == ["Personal · Weekly"])
    #expect(claude.map(\.used) == [0.2])
    let ids = Set(
        ["claude", "work"].flatMap {
            severalAccounts.rows(kind: "weekly", limit: 2, provider: "claude", account: $0, at: now).map(\.id)
        })
    #expect(ids.count == 2)
}

@Test func usageWidgetRowsOfAMachineBeforeAccountsReadAsBefore() {
    let old = UsageWidgetSnapshot(
        providers: [.init(kind: "claude", windows: [weekly(0.7), weekly(0.1, label: "Weekly · Opus")])], updatedAt: now)
    let rows = old.rows(kind: "weekly", limit: 3, provider: nil, account: nil, at: now)
    #expect(rows.map(\.id) == ["claude:claude:Weekly", "claude:claude:Weekly · Opus"])
    #expect(rows.map(\.title) == ["Claude", "Claude · Opus"])
    #expect(
        old.rows(kind: "weekly", limit: 3, provider: "claude", account: nil, at: now).map(\.title) == [
            "Weekly", "Opus",
        ])
}

@Test func usageWidgetRowPastItsResetReadsAsUnused() {
    let snapshot = UsageWidgetSnapshot(
        providers: [
            .init(kind: "codex", windows: [.init(kind: "session", label: "Session", used: 0.8, resetsAt: now)])
        ], updatedAt: now)
    #expect(snapshot.rows(kind: "session", limit: 1, provider: nil, account: nil, at: now).first?.used == 0)
}

@Test func usageWidgetCostFollowsTheAccountItShows() {
    #expect(severalAccounts.todayUSD(provider: nil, account: "work", at: now) == 10)
    #expect(severalAccounts.todayUSD(provider: "claude", account: nil, at: now) == 3)
    #expect(severalAccounts.todayUSD(provider: "claude", account: "work", at: now) == 5)
    #expect(severalAccounts.todayUSD(provider: "codex", account: nil, at: now) == 2)
    let tomorrow = now.addingTimeInterval(2 * 24 * 60 * 60)
    #expect(severalAccounts.todayUSD(provider: nil, account: nil, at: tomorrow) == nil)
}

@Test func usageWidgetSnapshotFromBeforeAccountsStillDecodes() throws {
    let data = Data(
        #"{"providers":[{"kind":"claude","windows":[]}],"updatedAt":0,"cost":{"day":"2026-09-25","usd":1,"fetchedAt":0}}"#
            .utf8)
    let snapshot = try JSONDecoder().decode(UsageWidgetSnapshot.self, from: data)
    #expect(snapshot.providers.first?.account == nil)
    #expect(snapshot.cost?.usdByAccount == nil)
}
