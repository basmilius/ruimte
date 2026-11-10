import Foundation
import RuimtePulsar
import XCTest

@testable import Ruimte

private final class MemoryUsageStore: UsageStore {
    var data: Data?
    var writes = 0
    func read() -> Data? { data }
    func write(_ next: Data) throws {
        data = next
        writes += 1
    }
}

@MainActor private final class Moment {
    var date: Date
    init(_ text: String) { date = ISO8601DateFormatter().date(from: text)! }
    func advance(days: Int) { date = date.addingTimeInterval(Double(days) * 86_400) }
}

@MainActor private final class Later {
    var runs: [@MainActor () -> Void] = []
    func run() {
        let pending = runs
        runs = []
        for run in pending { run() }
    }
}

@MainActor final class UsageDaysTests: XCTestCase {
    private func usage(
        _ store: MemoryUsageStore = MemoryUsageStore(), at moment: Moment = Moment("2026-10-27T09:00:00Z"),
        release: Bool = true, signedIn: Bool = true, later: Later = Later()
    ) -> UsageDays {
        UsageDays(
            store: store, version: "0.22.0", release: release, signedIn: { signedIn }, now: { moment.date },
            later: { later.runs.append($0) })
    }

    func testEveryNameFitsTheNamesTheIngestTakes() throws {
        let pattern = try NSRegularExpression(pattern: "^[A-Za-z][A-Za-z0-9_.]{0,63}$")
        let names = UsageCounter.allCases.map(\.rawValue)
        XCTAssertEqual(Set(names).count, names.count)
        for name in names {
            XCTAssertNotNil(pattern.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)), name)
            XCTAssertTrue(UsageIngest.isName(name), name)
        }
        XCTAssertFalse(UsageIngest.isName("../etc"))
        XCTAssertFalse(UsageIngest.isName("1screens"))
        XCTAssertFalse(UsageIngest.isName("screens.café"))
    }

    func testNothingCountsBeforeAMachineSaidItsSwitch() {
        let days = usage()
        days.count(.messageSent)
        XCTAssertFalse(days.counting)
        XCTAssertTrue(days.state.days.isEmpty)
        XCTAssertNil(days.firstDate)
    }

    func testABuildThatDoesNotShipCountsNothing() {
        let days = usage(release: false)
        days.heard(machineID: "studio", usageStats: true)
        days.count(.messageSent)
        XCTAssertTrue(days.state.days.isEmpty)
        XCTAssertFalse(CrashReports.enabled)
        XCTAssertFalse(UsageDays.counts(release: CrashReports.enabled, machines: ["studio": true]))
    }

    func testOneMachineOffStopsTheCountingAndDropsTheDaysNotSent() {
        let days = usage()
        days.heard(machineID: "studio", usageStats: true)
        days.heard(machineID: "laptop", usageStats: true)
        days.count(.messageSent)
        XCTAssertEqual(days.state.days.first?.counts, ["actions.messageSent": 1])

        days.heard(machineID: "laptop", usageStats: false)
        days.count(.messageSent)
        XCTAssertFalse(days.counting)
        XCTAssertTrue(days.state.days.isEmpty)

        days.heard(machineID: "laptop", usageStats: true)
        days.count(.chatStarted)
        XCTAssertEqual(days.state.days.first?.counts, ["actions.chatStarted": 1])
        XCTAssertEqual(days.state.days.first?.firstThisWeek, true)
    }

    func testAMachineThatLeftTheAccountHasNoSay() {
        let days = usage()
        days.heard(machineID: "studio", usageStats: true)
        days.heard(machineID: "old", usageStats: false)
        XCTAssertFalse(days.counting)
        days.keep(machineIDs: ["studio"])
        XCTAssertTrue(days.counting)
        days.keep(machineIDs: [])
        XCTAssertFalse(days.counting)
    }

    func testTheSwitchesAndDaysSurviveARestart() {
        let store = MemoryUsageStore()
        let days = usage(store)
        days.heard(machineID: "studio", usageStats: true)
        days.count(.screenNow)
        days.persist()
        let again = usage(store)
        again.load()
        XCTAssertTrue(again.counting)
        XCTAssertEqual(again.state, days.state)
    }

    func testCountsAreWrittenAtMostOnceAMinute() {
        let store = MemoryUsageStore()
        let later = Later()
        let days = usage(store, later: later)
        days.heard(machineID: "studio", usageStats: true)
        let written = store.writes
        days.count(.messageSent)
        days.count(.messageSent)
        XCTAssertEqual(store.writes, written)
        XCTAssertEqual(later.runs.count, 1)
        later.run()
        XCTAssertEqual(store.writes, written + 1)
    }

    func testAScreenThatShowsAgainWithoutAnotherCountsOnce() {
        let days = usage()
        days.heard(machineID: "studio", usageStats: true)
        days.screen(.screenNow)
        days.screen(.screenNow)
        days.screen(.screenChat)
        days.screen(.screenNow)
        XCTAssertEqual(days.state.days.first?.counts, ["screens.now": 2, "screens.chat": 1])
    }

    func testEachUTCDayIsItsOwnAndOnlyFinishedDaysGo() {
        let moment = Moment("2026-10-26T23:30:00Z")
        let days = usage(at: moment, signedIn: false)
        days.heard(machineID: "studio", usageStats: true)
        days.count(.messageSent)
        moment.date = moment.date.addingTimeInterval(60 * 60)
        days.count(.messageSent)
        days.count(.approvalAnswered)
        XCTAssertEqual(days.state.days.map(\.date), ["2026-10-26", "2026-10-27"])
        XCTAssertEqual(days.state.days.map(\.firstThisWeek), [true, false])
        XCTAssertEqual(days.state.days.map(\.firstThisMonth), [true, false])
        XCTAssertEqual(days.state.days.map(\.signedIn), [false, false])
        XCTAssertEqual(days.finished().map(\.date), ["2026-10-26"])
        XCTAssertEqual(days.firstDate, "2026-10-26")

        moment.advance(days: 9)
        XCTAssertTrue(days.finished().isEmpty, "a day the ingest would skip is not sent")
        days.count(.messageSent)
        XCTAssertEqual(days.state.days.map(\.date), ["2026-11-05"])
    }

    func testWeeksAreISOWeeksOfTheUTCDay() {
        XCTAssertEqual(UsageCalendar.isoWeek(of: "2026-10-27"), "2026-W44")
        XCTAssertEqual(UsageCalendar.isoWeek(of: "2027-01-01"), "2026-W53")
        XCTAssertEqual(UsageCalendar.isoWeek(of: "2024-12-30"), "2025-W01")
        XCTAssertEqual(UsageCalendar.date(of: ISO8601DateFormatter().date(from: "2026-10-27T23:59:59Z")!), "2026-10-27")
        XCTAssertEqual(UsageCalendar.date("2026-03-01", minusDays: 1), "2026-02-28")
    }

    func testADayGoesOutInTheIngestsShape() throws {
        let record = UsageDayRecord(
            date: "2026-10-26", version: "0.22.0", signedIn: true, firstThisWeek: true, firstThisMonth: false,
            counts: ["actions.messageSent": 250_000, "screens.now": 0, "screens.fromANewerVersion": 3])
        let day = try XCTUnwrap(UsageIngest.day(record, cohortWeek: "2026-W40", platform: "ios", arch: "arm64"))
        XCTAssertEqual(
            String(decoding: try UsageIngest.body(UsageIngestBatch(days: [day])), as: UTF8.self),
            #"{"days":[{"arch":"arm64","cohortWeek":"2026-W40","counts":{"actions.messageSent":100000},"#
                + #""date":"2026-10-26","firstThisMonth":false,"firstThisWeek":true,"launcher":"ios","platform":"ios","#
                + #""signedIn":true,"version":"0.22.0"}]}"#)
        XCTAssertNil(UsageIngest.day(record, cohortWeek: "2026-W50", platform: "ios", arch: "arm64"))
        let unreadable = UsageDayRecord(
            date: "2026-10-26", version: "0.22 beta", signedIn: false, firstThisWeek: false, firstThisMonth: false,
            counts: [:])
        XCTAssertNil(UsageIngest.day(unreadable, cohortWeek: "2026-W40", platform: "ios", arch: "arm64"))
    }

    func testABatchHoldsAtMostAWeek() {
        let days = (1...9).map { index in
            UsageIngestDay(
                date: String(format: "2026-10-%02d", 20 - index), version: "0.22.0", platform: "ios", arch: "arm64",
                launcher: "ios", signedIn: false, firstThisWeek: false, firstThisMonth: false, cohortWeek: "2026-W40",
                counts: [:])
        }
        XCTAssertEqual(UsageIngest.batches(days).map(\.days.count), [7, 2])
        XCTAssertEqual(UsageIngest.batches(days).first?.days.first?.date, "2026-10-19")
    }

    func testAFlushForgetsWhatWentOrWillNeverGoAndKeepsTheRest() async {
        let moment = Moment("2026-10-20T09:00:00Z")
        let days = usage(at: moment)
        days.heard(machineID: "studio", usageStats: true)
        for _ in 0..<3 {
            days.count(.messageSent)
            moment.advance(days: 1)
        }
        var sent: [[String]] = []
        await UsageIngest.flush(days, platform: "ios", arch: "arm64") { batch in
            sent.append(batch.days.map(\.date))
            throw UsageSendError(status: 503)
        }
        XCTAssertEqual(sent, [["2026-10-22", "2026-10-21", "2026-10-20"]])
        XCTAssertEqual(days.finished().count, 3)

        await UsageIngest.flush(days, platform: "ios", arch: "arm64") { _ in throw UsageSendError(status: 400) }
        XCTAssertTrue(days.finished().isEmpty)

        days.count(.messageSent)
        moment.advance(days: 1)
        await UsageIngest.flush(days, platform: "ios", arch: "arm64") { _ in }
        XCTAssertTrue(days.finished().isEmpty)
    }

    func testAFlushSendsNothingWhileAMachineIsOff() async {
        let moment = Moment("2026-10-20T09:00:00Z")
        let days = usage(at: moment)
        days.heard(machineID: "studio", usageStats: true)
        days.count(.messageSent)
        moment.advance(days: 1)
        days.heard(machineID: "laptop", usageStats: false)
        var sends = 0
        await UsageIngest.flush(days, platform: "ios", arch: "arm64") { _ in sends += 1 }
        XCTAssertEqual(sends, 0)
    }

    func testAMachineSaysItsSwitchInItsEndpointInfo() {
        XCTAssertTrue(MachineEndpoint.usageStats(in: EndpointWire.decoded(EndpointWire.info())))
        XCTAssertTrue(MachineEndpoint.usageStats(in: EndpointWire.decoded(EndpointWire.info(["usageStats": .bool(true)]))))
        XCTAssertFalse(
            MachineEndpoint.usageStats(in: EndpointWire.decoded(EndpointWire.info(["usageStats": .bool(false)]))))
    }

    func testOnlyARequestThatAnswersACardCountsAsAnAnswer() {
        XCTAssertEqual(UsageCounter.answering(.chatApprove), .approvalAnswered)
        XCTAssertEqual(UsageCounter.answering(.chatAnswer), .questionAnswered)
        XCTAssertNil(UsageCounter.answering(.chatSend))
    }
}
