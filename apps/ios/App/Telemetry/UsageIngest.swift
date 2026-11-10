import Foundation

/// A day as Observatory's usage ingest takes it (`crates/protocol/src/usage.rs` in Observatory), the shape the daemon
/// and the desktop app send too.
struct UsageIngestDay: Encodable, Equatable {
    let date: String
    let version: String
    let platform: String
    let arch: String
    let launcher: String
    let signedIn: Bool
    let firstThisWeek: Bool
    let firstThisMonth: Bool
    let cohortWeek: String
    let counts: [String: Int]
}

struct UsageIngestBatch: Encodable, Equatable {
    let days: [UsageIngestDay]
}

/// An answer of the ingest other than 2xx.
struct UsageSendError: Error, Equatable {
    let status: Int
}

enum UsageIngest {
    static let maxDaysPerBatch = 7
    /// A day older than this, counted back from today, is skipped by the ingest.
    static let maxAgeDays = 8
    static let maxCount = 100_000
    static let maxCounters = 500
    // A DSN only lets a client send, so it is no secret; this is the usage ingest of the iOS app's DSN.
    static let url = URL(string: "https://ingest.bmnw.nl/api/6/usage/?sentry_key=48ef3786734e40099009e3cf2bf9ffae")!

    private static let counters = Set(UsageCounter.allCases.map(\.rawValue))

    static func isName(_ name: String) -> Bool {
        guard let first = name.unicodeScalars.first, first.isASCII, CharacterSet.letters.contains(first),
            name.utf8.count <= 64
        else { return false }
        return name.unicodeScalars.allSatisfy {
            $0.isASCII && (CharacterSet.alphanumerics.contains($0) || "_.".unicodeScalars.contains($0))
        }
    }

    /// What the ingest takes as a version, a platform, an architecture or a launcher.
    static func isToken(_ text: String) -> Bool {
        !text.isEmpty && text.utf8.count <= 64
            && text.unicodeScalars.allSatisfy {
                $0.isASCII && (CharacterSet.alphanumerics.contains($0) || "._+-".unicodeScalars.contains($0))
            }
    }

    /// The day as the ingest takes it, or nil when it never would. A name a newer version wrote and this one does not
    /// know is left out, as are zeros.
    static func day(_ record: UsageDayRecord, cohortWeek: String, platform: String, arch: String) -> UsageIngestDay? {
        let counts = record.counts.filter { counters.contains($0.key) && $0.value > 0 }.mapValues { min($0, maxCount) }
        guard isToken(record.version), counts.count <= maxCounters, let week = UsageCalendar.isoWeek(of: record.date),
            cohortWeek <= week
        else { return nil }
        return UsageIngestDay(
            date: record.date, version: record.version, platform: platform, arch: arch, launcher: "ios",
            signedIn: record.signedIn, firstThisWeek: record.firstThisWeek, firstThisMonth: record.firstThisMonth,
            cohortWeek: cohortWeek, counts: counts)
    }

    /// Newest first, at most a week per batch.
    static func batches(_ days: [UsageIngestDay]) -> [UsageIngestBatch] {
        stride(from: 0, to: days.count, by: maxDaysPerBatch).map {
            UsageIngestBatch(days: Array(days[$0..<min($0 + maxDaysPerBatch, days.count)]))
        }
    }

    static func body(_ batch: UsageIngestBatch) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try encoder.encode(batch)
    }

    /// Straight to Observatory, with no token or key of the app, so nothing ties a day to an install.
    static func send(_ batch: UsageIngestBatch, session: URLSession = .shared) async throws {
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try body(batch)
        let (_, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw UsageSendError(status: status) }
    }

    /// Sends the finished days once each. A 400 drops a batch too, since it would never be taken; any other failure
    /// keeps the days for the next try, until they are too old to keep.
    @MainActor static func flush(
        _ usage: UsageDays, platform: String, arch: String, send: (UsageIngestBatch) async throws -> Void
    ) async {
        guard usage.counting, let firstDate = usage.firstDate, let cohortWeek = UsageCalendar.isoWeek(of: firstDate)
        else { return }
        let records = usage.finished()
        guard !records.isEmpty else { return }
        let days = records.compactMap { day($0, cohortWeek: cohortWeek, platform: platform, arch: arch) }
        let sendable = Set(days.map(\.date))
        let unsendable = records.map(\.date).filter { !sendable.contains($0) }
        if !unsendable.isEmpty { usage.forget(unsendable) }
        for batch in batches(days) {
            let dates = batch.days.map(\.date)
            do {
                try await send(batch)
                usage.forget(dates)
            } catch let failure as UsageSendError where failure.status == 400 {
                usage.forget(dates)
            } catch {
                break
            }
            // A machine that said off while the batch was out took the days with it.
            guard usage.counting else { return }
        }
        usage.persist()
    }
}
