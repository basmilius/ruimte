import RuimtePulsar
import XCTest

@testable import RuimteTransport

final class IceCandidateTests: XCTestCase {
    func testCandidatesWaitForTheAnswerAndThenTrickleWithoutAnotherGatheringDelay() {
        var queue = PendingIceCandidates()
        let host = JSONValue.string("host")
        let relay = JSONValue.string("relay")
        XCTAssertNil(queue.generated(host))
        XCTAssertNil(queue.generated(relay))
        XCTAssertEqual(queue.answerApplied(), [host, relay])
        XCTAssertEqual(queue.generated(.string("late")), .string("late"))
        XCTAssertTrue(queue.answerApplied().isEmpty)
    }
}
