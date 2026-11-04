import Foundation
import Synchronization

/// What makes two reports the same error, as `eventKey` in `packages/telemetry` reads it.
struct CrashSignature: Equatable {
    var fingerprint: [String] = []
    var type = ""
    /// The scrubbed message of the error, or of the event when it has no error.
    var value = ""
    /// `file:function` of each frame of the app's own code, the caller first, as a stack trace lists them.
    var appFrames: [String] = []

    private static let topFrames = 3

    /// The fingerprint the code gave it, or else the error's type, its message and the top frames of the app's own
    /// code. Hashed, so the store holds no text.
    var key: String {
        if !fingerprint.isEmpty && !fingerprint.contains("{{ default }}") {
            return Self.hash(fingerprint.joined(separator: "\u{0}"))
        }
        return Self.hash(([type, value] + appFrames.suffix(Self.topFrames)).joined(separator: "\u{0}"))
    }

    /// FNV-1a over UTF-16, 32 bits, so a key here equals the shared one.
    static func hash(_ text: String) -> String {
        var value: UInt32 = 0x811c_9dc5
        for unit in text.utf16 {
            value ^= UInt32(unit)
            value = value &* 0x0100_0193
        }
        let hex = String(value, radix: 16)
        return String(repeating: "0", count: 8 - hex.count) + hex
    }
}

/// Where the dedupe keeps what it sent: milliseconds since the epoch per key.
protocol CrashDedupeStore: Sendable {
    func read() -> [String: Double]
    func write(_ entries: [String: Double])
}

struct DefaultsCrashDedupeStore: CrashDedupeStore {
    static let key = "ruimte.telemetry.sent"
    // Foundation documents `UserDefaults` as thread-safe, which the SDK does not mark as `Sendable`.
    nonisolated(unsafe) let defaults: UserDefaults

    func read() -> [String: Double] {
        defaults.dictionary(forKey: Self.key) as? [String: Double] ?? [:]
    }

    func write(_ entries: [String: Double]) {
        defaults.set(entries, forKey: Self.key)
    }
}

/// One report per error per day per installation, so a loop that fails costs one event and not thousands.
final class CrashDedupe: Sendable {
    private static let day: Double = 24 * 60 * 60 * 1000
    private let store: any CrashDedupeStore
    private let now: @Sendable () -> Double
    /// How many keys are remembered at most; the oldest go first.
    private let limit: Int
    // Reports come from the SDK's own threads.
    private let lock = Mutex(())

    init(
        store: any CrashDedupeStore, limit: Int = 200,
        now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }
    ) {
        self.store = store
        self.limit = limit
        self.now = now
    }

    /// Whether a report may go out: false when one with the same key went out in the last day. Remembers it when it may.
    func admit(_ key: String) -> Bool {
        lock.withLock { _ in
            let at = now()
            var fresh = store.read().filter { at - $0.value < Self.day && $0.value <= at }
            if fresh[key] != nil {
                return false
            }
            fresh[key] = at
            let kept = fresh.sorted { $0.value < $1.value }.suffix(limit)
            store.write(Dictionary(uniqueKeysWithValues: kept.map { ($0.key, $0.value) }))
            return true
        }
    }
}
