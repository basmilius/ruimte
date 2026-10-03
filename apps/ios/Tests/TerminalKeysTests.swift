import Testing

@testable import Ruimte

@Suite struct TerminalKeysTests {
    @Test func ctrlTurnsALetterIntoItsControlCharacter() {
        #expect(TerminalKeys.control("c") == "\u{03}")
        #expect(TerminalKeys.control("C") == "\u{03}")
        #expect(TerminalKeys.control("d") == "\u{04}")
        #expect(TerminalKeys.control("[") == "\u{1b}")
        #expect(TerminalKeys.control(" ") == "\u{0}")
        #expect(TerminalKeys.control("?") == "\u{7f}")
    }

    @Test func aKeyWithoutAControlFormGoesOutAsTyped() {
        #expect(TerminalKeys.control("1") == nil)
        #expect(TerminalKeys.control("é") == nil)
        #expect(TerminalKeys.control("ab") == nil)
        #expect(TerminalKeys.control("") == nil)
    }

    @Test func arrowsFollowTheCursorModeTheProgramAskedFor() {
        #expect(TerminalKeys.arrow(up: true, applicationCursor: false) == "\u{1b}[A")
        #expect(TerminalKeys.arrow(up: false, applicationCursor: false) == "\u{1b}[B")
        #expect(TerminalKeys.arrow(up: true, applicationCursor: true) == "\u{1b}OA")
    }
}
