import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor final class RemotePageStateTests: XCTestCase {
    func testAFirstReadShowsTheSpinnerAndARereadKeepsWhatIsOnScreen() async {
        let state = RemotePageState()
        var seen: [Bool] = []
        await state.load {
            seen.append(state.loading)
            return .string("first")
        }
        await state.load {
            seen.append(state.loading)
            return .string("second")
        }
        XCTAssertEqual(seen, [true, false])
        XCTAssertEqual(state.value, .string("second"))
        XCTAssertFalse(state.loading)
    }

    func testAReadThatSucceedsClearsTheReasonTheLastOneFailed() async {
        let state = RemotePageState()
        await state.load { throw TransportFailure.invalid("No answer") }
        XCTAssertEqual(state.problem, "No answer")
        XCTAssertNil(state.value)
        await state.load { .string("ok") }
        XCTAssertNil(state.problem)
    }

    func testACancelledReadLeavesNothingToRead() async {
        let state = RemotePageState()
        await state.load { throw TransportFailure.invalid("Older failure") }
        for cancellation in [CancellationError() as any Error, URLError(.cancelled)] {
            await state.load { throw cancellation }
            XCTAssertEqual(state.problem, "Older failure")
        }
        XCTAssertFalse(state.loading)
    }

    /// A page left and reopened reads twice; the answer that is overtaken must not put its value, its spinner or its
    /// failure over the newer read's.
    func testAnOvertakenReadWritesNothing() async {
        let state = RemotePageState()
        let slow = Gate()
        let overtaken = Task { @MainActor in
            await state.read { stillTheLatest in
                await slow.wait()
                try stillTheLatest()
                state.value = .string("stale")
            }
        }
        await Task.yield()
        await state.load { .string("fresh") }
        await slow.open()
        await overtaken.value
        XCTAssertEqual(state.value, .string("fresh"))
        XCTAssertNil(state.problem)
        XCTAssertFalse(state.loading)
    }

    func testAnOvertakenReadDoesNotReportItsFailureEither() async {
        let state = RemotePageState()
        let slow = Gate()
        let overtaken = Task { @MainActor in
            await state.read { _ in
                await slow.wait()
                throw TransportFailure.invalid("Stale failure")
            }
        }
        await Task.yield()
        await state.load { .string("fresh") }
        await slow.open()
        await overtaken.value
        XCTAssertNil(state.problem)
    }

    func testAnActionIsRefusedWhileAnotherIsStillRunning() async {
        let state = RemotePageState()
        let slow = Gate()
        var runs = 0
        let first = Task { @MainActor in
            await state.perform {
                runs += 1
                await slow.wait()
            }
        }
        await Task.yield()
        XCTAssertTrue(state.busy)
        await state.perform { runs += 1 }
        XCTAssertEqual(runs, 1)
        await slow.open()
        await first.value
        XCTAssertFalse(state.busy)
    }

    func testAnActionReportsItsFailureAndAnActionThatWasCancelledDoesNot() async {
        let state = RemotePageState()
        await state.perform { throw TransportFailure.invalid("Could not open") }
        XCTAssertEqual(state.problem, "Could not open")
        await state.perform { throw CancellationError() }
        XCTAssertEqual(state.problem, "Could not open")
        await state.perform {}
        XCTAssertNil(state.problem)
    }
}

/// Holds one operation until the test lets it through, so two of them overlap without a clock.
private actor Gate {
    private var waiter: CheckedContinuation<Void, Never>?
    private var opened = false

    func wait() async {
        guard !opened else { return }
        await withCheckedContinuation { waiter = $0 }
    }

    func open() {
        opened = true
        waiter?.resume()
        waiter = nil
    }
}
