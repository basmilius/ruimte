import ComputerUseCore
import CoreGraphics
import Testing

struct KeyComboTests {
    @Test func modifiersAndLetter() throws {
        let combo = try KeyCombo.parse("cmd+shift+n")
        #expect(combo.keyCode == 45)
        #expect(combo.flags == [.maskCommand, .maskShift])
        #expect(combo.name == "cmd+shift+n")
    }

    @Test func modifierAliasesAndCase() throws {
        let combo = try KeyCombo.parse(" Command+Opt+Control+A ")
        #expect(combo.keyCode == 0)
        #expect(combo.flags == [.maskCommand, .maskAlternate, .maskControl])
    }

    @Test func bareKeyHasNoFlags() throws {
        let combo = try KeyCombo.parse("return")
        #expect(combo.keyCode == 36)
        #expect(combo.flags.isEmpty)
    }

    @Test func plusIsShiftedEquals() throws {
        for text in ["+", "plus", "cmd++", "cmd+plus"] {
            let combo = try KeyCombo.parse(text)
            #expect(combo.keyCode == 24, "\(text)")
            #expect(combo.flags.contains(.maskShift), "\(text)")
        }
        #expect(try KeyCombo.parse("cmd++").flags.contains(.maskCommand))
    }

    @Test func arrowsCarryFunctionAndKeypadBits() throws {
        let combo = try KeyCombo.parse("shift+up")
        #expect(combo.keyCode == 126)
        #expect(combo.flags == [.maskShift, .maskNumericPad, .maskSecondaryFn])
        #expect(try KeyCombo.parse("pagedown").flags == [.maskSecondaryFn])
    }

    @Test func refusesWhatItDoesNotKnow() {
        #expect(throws: AgentError.self) { try KeyCombo.parse("hyper+a") }
        #expect(throws: AgentError.self) { try KeyCombo.parse("cmd+") }
        #expect(throws: AgentError.self) { try KeyCombo.parse("f13") }
        #expect(throws: AgentError.self) { try KeyCombo.parse("") }
    }
}
