import RuimtePulsar
import XCTest

@testable import RuimteTransport

final class IceCandidateTests: XCTestCase {
    func testCandidatesInTheOfferAreNotReplayedAfterTheAnswer() {
        var queue = PendingIceCandidates()
        let host = candidate("candidate:1 1 udp 2122260223 192.0.2.1 5000 typ host")
        XCTAssertNil(
            queue.generated(candidate(host["candidate"]!.stringValue! + " generation 0 ufrag test network-cost 10\r\n"))
        )
        queue.offered("v=0\r\na=\(host["candidate"]!.stringValue!)\r\n")
        XCTAssertTrue(queue.answerApplied().isEmpty)
        XCTAssertNil(queue.generated(host))
    }

    func testOfferDeduplicationKeepsCandidatesGatheredAfterTheOffer() {
        var queue = PendingIceCandidates()
        let host = candidate("candidate:1 1 udp 2122260223 192.0.2.1 5000 typ host")
        let relay = candidate("candidate:2 1 udp 1677734911 192.0.2.2 6000 typ relay")
        XCTAssertNil(queue.generated(relay))
        queue.offered("v=0\r\na=\(host["candidate"]!.stringValue!)\r\n")
        XCTAssertNil(queue.generated(host))
        XCTAssertNil(queue.generated(relay))
        XCTAssertEqual(queue.answerApplied(), [relay])
        XCTAssertNil(queue.generated(relay))
    }

    private func candidate(_ value: String) -> JSONValue {
        .object([
            "kind": .string("candidate"), "candidate": .string(value),
            "sdpMid": .string("0"), "sdpMLineIndex": .number(0),
        ])
    }

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
