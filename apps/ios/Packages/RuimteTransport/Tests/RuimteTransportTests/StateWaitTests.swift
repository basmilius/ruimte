import Observation
import Testing

@testable import RuimteTransport

@MainActor @Observable private final class Gate {
    var open = false
    var count = 0
}

@MainActor struct StateWaitTests {
    @Test func aConditionThatAlreadyHoldsReturnsAtOnce() async {
        let gate = Gate()
        gate.open = true
        #expect(await waitUntil { gate.open })
    }

    @Test func aChangeOfTheObservedStateWakesTheWaiter() async {
        let gate = Gate()
        let waiter = Task { @MainActor in await waitUntil { gate.count >= 2 } }
        await Task.yield()
        gate.count = 1
        await Task.yield()
        gate.count = 2
        #expect(await waiter.value)
    }

    @Test func aCancelledWaiterReturnsFalse() async {
        let gate = Gate()
        let waiter = Task { @MainActor in await waitUntil { gate.open } }
        await Task.yield()
        waiter.cancel()
        #expect(await waiter.value == false)
    }

    @Test func aDeadlineThatPassesReturnsFalse() async {
        let gate = Gate()
        #expect(await waitUntil(deadline: {}, { gate.open }) == false)
    }

    @Test func aConditionThatHoldsBeforeTheDeadlineReturnsTrue() async {
        let gate = Gate()
        gate.open = true
        #expect(await waitUntil(deadline: { try? await Task.sleep(for: .seconds(3600)) }, { gate.open }))
    }

    @Test func aStateThatChangesAfterTheDeadlineStillCountsWhenItHolds() async {
        let gate = Gate()
        let result = await waitUntil(
            deadline: {
                await MainActor.run { gate.open = true }
            }, { gate.open })
        #expect(result)
    }
}
