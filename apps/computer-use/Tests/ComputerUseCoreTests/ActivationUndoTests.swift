import ComputerUseCore
import Testing

struct ActivationUndoTests {
    @Test func undoesAnActivationTheAppDidItselfWhileTheAgentWorks() {
        #expect(ActivationUndo.shouldUndo(now: 10, keepUntil: 12, sinceMouseDown: 30, sinceKey: 30))
    }

    @Test func leavesTheSwitchOfAPersonWhoJustClickedOrTyped() {
        #expect(!ActivationUndo.shouldUndo(now: 10, keepUntil: 12, sinceMouseDown: 0.1, sinceKey: 30))
        #expect(!ActivationUndo.shouldUndo(now: 10, keepUntil: 12, sinceMouseDown: 30, sinceKey: 0.2))
    }

    @Test func leavesEverythingOutsideTheAgentsWork() {
        #expect(!ActivationUndo.shouldUndo(now: 13, keepUntil: 12, sinceMouseDown: 30, sinceKey: 30))
        #expect(!ActivationUndo.shouldUndo(now: 10, keepUntil: nil, sinceMouseDown: 30, sinceKey: 30))
    }
}
