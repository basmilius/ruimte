import Foundation

/// A write against the rev it was read at, and what to do when the machine has moved on: the one rule of the
/// project, launches and drawing saves.
///
/// A `rev-conflict` reloads, and when the reload merged onto a newer rev the request goes out again, at most
/// `retries` times over the life of one value. A save that must not guess, such as a launch list edited by hand, sends
/// without a reload and surfaces the first conflict.
@MainActor public struct RevSave {
    public enum Outcome<Value> {
        case saved(Value)
        /// The conflict stood: the retries are used up, or the reload had nothing newer to merge onto.
        case conflict(any Error)
        case failed(any Error)
    }

    public static let retries = 2

    private var conflicts = 0

    public init() {}

    /// `request` reads what it sends afresh on every try, since a reload changes it. `reload` answers whether the
    /// copy moved on to a newer rev and the same edit can go out again.
    public mutating func send<Value>(
        _ request: () async throws -> Value, reload: () async -> Bool = { false }
    ) async -> Outcome<Value> {
        while true {
            do {
                return .saved(try await request())
            } catch let error as MachineClientError where error.code == .revConflict {
                conflicts += 1
                guard conflicts <= Self.retries, await reload() else { return .conflict(error) }
            } catch {
                return .failed(error)
            }
        }
    }
}
