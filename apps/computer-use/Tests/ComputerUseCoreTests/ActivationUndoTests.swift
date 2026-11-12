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

    @Test func reportsAnActivationMacOSRefusedAsRefused() {
        #expect(ActivationUndo.undo(now: 10, keepUntil: 12, sinceMouseDown: 30, sinceKey: 30) { false } == .refused)
        #expect(ActivationUndo.undo(now: 10, keepUntil: 12, sinceMouseDown: 30, sinceKey: 30) { true } == .restored)
    }

    @Test func activatesNothingWhenTheActivationStays() {
        var asked = false
        let outcome = ActivationUndo.undo(now: 10, keepUntil: 12, sinceMouseDown: 0.1, sinceKey: 30) {
            asked = true
            return true
        }
        #expect(outcome == .left)
        #expect(!asked)
    }
}
