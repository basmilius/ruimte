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

    @Test func aRefusalOutsideTheLaunchHoldsTheSessionAsATakeOver() {
        #expect(ActivationUndo.consequence(of: .refused, inGrace: false, acceptsTakeover: true) == .keptInFront)
        #expect(ActivationUndo.consequence(of: .left, inGrace: false, acceptsTakeover: true) == .takeOver)
    }

    @Test func aRefusalThatTakesNothingOverGoesInTheNote() {
        #expect(ActivationUndo.consequence(of: .refused, inGrace: true, acceptsTakeover: true) == .note)
        #expect(ActivationUndo.consequence(of: .refused, inGrace: false, acceptsTakeover: false) == .note)
        #expect(ActivationUndo.consequence(of: .left, inGrace: true, acceptsTakeover: true) == .nothing)
        #expect(ActivationUndo.consequence(of: .restored, inGrace: false, acceptsTakeover: true) == .nothing)
    }

    @Test func aRefusalKeepsTheTakeOverCodeAndSaysWhatMacOSDid() {
        var control = SessionControl()
        control.begin(at: 0)
        let refusal = ActivationUndo.refusal(operated: "Safari", person: "Notes")
        control.takeOver(at: 1, because: .keptInFront(refusal))
        #expect(control.refusal?.code == AgentError.takenOver.code)
        #expect(control.refusal?.message.hasPrefix("macOS kept Safari in front of Notes and did not bring Notes back") == true)
        control.resume(at: 2)
        control.takeOver(at: 3)
        #expect(control.refusal?.message == AgentError.takenOver.message)
    }
}
