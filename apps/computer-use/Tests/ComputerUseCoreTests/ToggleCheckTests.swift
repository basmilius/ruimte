import ComputerUseCore
import Testing

struct ToggleCheckTests {
    @Test func aCheckboxThatChangedWasPressed() {
        #expect(ToggleCheck.pressed(role: "AXCheckBox", before: 0, now: 1))
        #expect(ToggleCheck.pressed(role: "AXCheckBox", before: 1, now: 0))
        #expect(!ToggleCheck.pressed(role: "AXCheckBox", before: 1, now: 1))
    }

    @Test func aRadioButtonWasPressedOnlyWhenItBecameSelected() {
        #expect(ToggleCheck.pressed(role: "AXRadioButton", before: 0, now: 1))
        #expect(!ToggleCheck.pressed(role: "AXRadioButton", before: 1, now: 0))
        #expect(!ToggleCheck.pressed(role: "AXRadioButton", before: 1, now: 1))
    }

    @Test func nothingElseCountsWithoutAValue() {
        #expect(!ToggleCheck.pressed(role: "AXButton", before: 0, now: 1))
        #expect(!ToggleCheck.pressed(role: "AXCheckBox", before: nil, now: 1))
    }
}
