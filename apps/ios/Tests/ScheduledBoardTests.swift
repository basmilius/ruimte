import Foundation
import RuimtePulsar
import RuimteShared
import Testing

@testable import Ruimte

@Suite @MainActor struct ScheduledBoardTests {
    /// Monday 26 October 2026, 14:20 UTC.
    private static let now = Date(timeIntervalSince1970: 1_793_024_400)

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private static let english = FormatLocale(
        region: Locale(identifier: "en_GB"), language: Locale(identifier: "en"), timeZone: TimeZone(identifier: "UTC")!)

    @Test func routinesFallUnderWhatAPersonNeedsToKnow() {
        let hour = 3_600.0
        let entries = [
            entry("tonight", next: Self.now.addingTimeInterval(8 * hour)),
            entry("morning", next: Self.now.addingTimeInterval(18 * hour)),
            entry("friday", next: Self.now.addingTimeInterval(4 * 24 * hour)),
            entry("evening", next: Self.now.addingTimeInterval(2 * hour)),
            entry("paused", next: nil, paused: true),
            entry("unapproved", next: nil, approved: false),
            entry("ended", next: nil),
            entry(
                "waiting", next: Self.now.addingTimeInterval(19 * hour),
                runs: [run("r2", state: "needs-you", chat: "chat-1"), run("r1", state: "done")]),
        ]
        let board = ScheduledBoard.build([input(entries)], now: Self.now, calendar: Self.calendar)
        #expect(board.needsYou.map(\.item.entry.id) == ["waiting"])
        #expect(board.needsYou.first?.run.chatId == "chat-1")
        #expect(board.today.map(\.entry.id) == ["evening", "tonight"])
        #expect(board.overnight.map(\.entry.id) == ["morning", "waiting"])
        #expect(board.later.map(\.entry.id) == ["friday"])
        #expect(board.held.map(\.entry.id) == ["paused", "unapproved"])
        #expect(board.answered)
    }

    @Test func aMachineWithoutRoutinesIsNamedAndListsNothing() {
        let older = ScheduledMachineInput(
            machineID: "old", machineName: "Studio", answers: false, entries: [])
        let unreached = ScheduledMachineInput(
            machineID: "far", machineName: "Laptop", answers: nil, entries: [])
        let board = ScheduledBoard.build([older, unreached], now: Self.now, calendar: Self.calendar)
        #expect(board.outdated == ["Studio"])
        #expect(!board.answered)
        #expect(board.isEmpty)
    }

    @Test func aScheduleReadsInWords() {
        func words(_ json: JSONValue) -> String { json.routineSchedule.words(timeZone: nil, in: Self.english) }
        let clock = "08:30"
        #expect(words(weekly([1, 2, 3, 4, 5, 6, 7])) == String(localized: "Daily at \(clock)"))
        #expect(words(weekly([1, 2, 3, 4, 5])) == String(localized: "Weekdays at \(clock)"))
        #expect(words(weekly([7, 6])) == String(localized: "Weekends at \(clock)"))
        let days = "Mon, Thu"
        #expect(words(weekly([4, 1])) == String(localized: "\(days) at \(clock)"))
        let day = "Mon 26 Oct"
        let time = "22:00"
        #expect(words(RoutineWire.once(date: "2026-10-26", time: "22:00")) == String(localized: "Once, \(day) \(time)"))
    }

    @Test func aCronShowsItsExpression() {
        let expression = "0 9 * * 1-5"
        let schedule = RoutineWire.cron(expression).routineSchedule
        #expect(schedule == .cron(RoutineCronSchedule(expression: expression)))
        #expect(schedule.words(timeZone: nil, in: Self.english) == String(localized: "Cron \(expression)"))
        #expect(schedule.words(timeZone: nil, in: Self.english) == "Cron 0 9 * * 1-5")
    }

    @Test func anIntervalReadsItsDaysStepAndWindow() {
        func words(_ days: [Int], _ every: Int) -> String {
            RoutineWire.interval(days, every: every).routineSchedule.words(timeZone: nil, in: Self.english)
        }
        let start = "09:00"
        let end = "17:00"
        func expected(_ days: String, _ step: String) -> String {
            String(localized: "\(days), \(step) from \(start) to \(end)")
        }
        let minutes = 30
        let hours = 2
        #expect(words([1, 2, 3, 4, 5], 60) == expected(String(localized: "Weekdays"), String(localized: "every hour")))
        #expect(
            words([1, 2, 3, 4, 5, 6, 7], minutes)
                == expected(String(localized: "Daily"), String(localized: "every \(minutes) minutes")))
        #expect(words([3, 1], 120) == expected("Mon, Wed", String(localized: "every \(hours) hours")))
    }

    @Test func anEntryReadsWhatTheMachineKeepsOfIt() {
        let entry = RoutineWire.entry(
            "deps", title: "Dependency check", projectName: "adecore", pausedAt: 1_792_000_000_000,
            runs: [RoutineWire.run("r1", state: "done", due: 1_792_000_000_000, version: 3)]
        ).routineEntry
        #expect(entry.isHeld)
        #expect(entry.nextDate == nil)
        #expect(entry.runs.first?.versionNumber == 3)
        #expect(entry.runs.first?.chatId == nil)
        #expect(entry.waitingRun == nil)
    }

    private func weekly(_ days: [Int]) -> JSONValue { RoutineWire.weekly(days) }

    private func input(_ entries: [RoutineEntry]) -> ScheduledMachineInput {
        ScheduledMachineInput(machineID: "mac", machineName: "Mac", answers: true, entries: entries)
    }

    private func run(_ id: String, state: String, chat: String? = nil) -> JSONValue {
        RoutineWire.run(id, state: state, due: Self.now.timeIntervalSince1970 * 1000, chat: chat)
    }

    private func entry(
        _ id: String, next: Date?, paused: Bool = false, approved: Bool = true, runs: [JSONValue] = []
    ) -> RoutineEntry {
        RoutineWire.entry(
            id, approved: approved, pausedAt: paused ? Self.now.timeIntervalSince1970 * 1000 : nil,
            next: next.map { $0.timeIntervalSince1970 * 1000 }, runs: runs
        ).routineEntry
    }
}
