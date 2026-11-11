import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatGoalTests: XCTestCase {
    private func goal(
        _ status: ChatGoalStatus, checks: Int64? = nil, used: Int64? = nil, budget: Int64? = nil
    ) -> ChatInfoGoal {
        ChatInfoGoal(objective: "ship it", status: status, checks: checks, tokensUsed: used, tokenBudget: budget)
    }

    private func actions(
        _ status: ChatGoalStatus, turn: String? = nil, goals: String? = "native", canAct: Bool = true
    ) -> [ChatGoalAction]? {
        ChatGoalView(goal: goal(status), activeTurnID: turn, goals: goals, canAct: canAct)?.actions
    }

    func testNoGoalNoRow() {
        XCTAssertNil(ChatGoalView(goal: nil, activeTurnID: nil, goals: "native", canAct: true))
    }

    func testACLIWithGoalCallsPausesAnActiveGoalResumesAStoppedOneAndClearsAny() {
        XCTAssertEqual(actions(.active, turn: "turn"), [.pause, .clear])
        XCTAssertEqual(actions(.paused), [.resume, .clear])
        XCTAssertEqual(actions(.budgetLimited), [.resume, .clear])
        XCTAssertEqual(actions(.complete), [.clear])
    }

    func testACLIThatOnlyReadsTheGoalCommandClearsBetweenTurnsAndNeverAGoalItMet() {
        XCTAssertEqual(actions(.paused, goals: "command"), [.clear])
        XCTAssertEqual(actions(.active, turn: "turn", goals: "command"), [])
        XCTAssertEqual(actions(.complete, goals: "command"), [])
    }

    func testAMachineWithoutTheRequestOrACLIWithoutGoalsShowsTheGoalAndOffersNothing() {
        XCTAssertEqual(actions(.active, turn: "turn", canAct: false), [])
        XCTAssertEqual(actions(.active, turn: "turn", goals: nil), [])
    }

    func testAStateOfANewerMachineAsksForAnUpdateAndOffersNothing() {
        XCTAssertEqual(actions(.unknown("future-status")), [])
        XCTAssertEqual(
            ChatGoalView(goal: goal(.unknown("future-status")), activeTurnID: nil, goals: "native", canAct: true)?
                .status,
            "Update Ruimte to see this.")
    }

    func testTheLineSaysHowFarTheGoalGotInWhatItsCLICounts() {
        func line(_ goal: ChatInfoGoal) -> String? {
            ChatGoalView(goal: goal, activeTurnID: nil, goals: "native", canAct: true)?.line
        }
        XCTAssertEqual(line(goal(.active)), "ship it")
        XCTAssertEqual(line(goal(.active, checks: 2)), "ship it · 2 checks not met yet")
        XCTAssertEqual(line(goal(.active, checks: 1)), "ship it · 1 check not met yet")
        XCTAssertEqual(line(goal(.active, used: 0)), "ship it")
        XCTAssertEqual(line(goal(.active, used: 12_400)), "ship it · 12K tokens")
        XCTAssertEqual(
            line(goal(.active, checks: 1, used: 0, budget: 50_000)), "ship it · 1 check not met yet · 0 of 50K tokens")
    }
}
