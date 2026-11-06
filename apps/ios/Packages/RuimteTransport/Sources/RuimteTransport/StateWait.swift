import Observation

/// Wakes one waiter, once, from whichever of a state change or a cancellation comes first.
@MainActor private final class StateSignal {
    private var continuation: CheckedContinuation<Void, Never>?

    func install(_ next: CheckedContinuation<Void, Never>) { continuation = next }

    func fire() {
        continuation?.resume()
        continuation = nil
    }
}

/// Waits until `condition` holds, woken by a change of the `@Observable` state it reads instead of by a clock. False
/// only when the task was cancelled first.
@MainActor public func waitUntil(_ condition: @MainActor @escaping () -> Bool) async -> Bool {
    while !Task.isCancelled {
        let signal = StateSignal()
        var holds = false
        await withTaskCancellationHandler {
            await withCheckedContinuation { (next: CheckedContinuation<Void, Never>) in
                signal.install(next)
                // The check and the observation are one step, so a change between them is not lost.
                holds = withObservationTracking(condition) { Task { @MainActor in signal.fire() } }
                if holds { signal.fire() }
            }
        } onCancel: {
            Task { @MainActor in signal.fire() }
        }
        if holds { return true }
    }
    return false
}

/// `waitUntil` for a state that may never come, such as a row a machine was asked to write. The deadline is the
/// behavior: false once it passed with the condition still false, or the task was cancelled.
@MainActor public func waitUntil(timeout: Duration, _ condition: @MainActor @escaping () -> Bool) async
    -> Bool
{
    await waitUntil(
        deadline: { try? await Task.sleep(for: timeout) }, condition)
}

/// Flips when a deadline passes, so a waiter on the condition wakes for it like for any other change.
@MainActor @Observable private final class Deadline {
    var passed = false
}

/// The deadline is passed in so a test can end it without waiting a clock out.
@MainActor func waitUntil(
    deadline: @escaping @Sendable () async -> Void, _ condition: @MainActor @escaping () -> Bool
) async -> Bool {
    let clock = Deadline()
    let timer = Task { @MainActor in
        await deadline()
        clock.passed = true
    }
    defer { timer.cancel() }
    _ = await waitUntil { condition() || clock.passed }
    return condition()
}
