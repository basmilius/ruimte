import ComputerUseCore
import Testing

struct FocusLandingTests {
    /// TextEdit's window as accessibility reports it: a text area in a scroll area, and a toolbar with the font size
    /// combo box, which holds the text field an app hands the focus to.
    private let parents: [String: String] = [
        "scroll": "window",
        "text": "scroll",
        "toolbar": "window",
        "size": "toolbar",
        "size-field": "size",
        "field-editor": "size-field",
    ]

    private func reached(_ requested: String, focused: String?) -> Bool {
        var ancestors: [String] = []
        var current = focused.flatMap { parents[$0] }
        while let name = current {
            ancestors.append(name)
            current = parents[name]
        }
        return FocusLanding.reached(requested, focused: focused, focusedAncestors: ancestors)
    }

    @Test func theRequestedElementHoldingTheFocusIsReached() {
        #expect(reached("text", focused: "text"))
        #expect(reached("size", focused: "size"))
    }

    @Test func aFieldInsideTheRequestedElementHoldingTheFocusIsReached() {
        #expect(reached("size", focused: "size-field"))
        #expect(reached("size", focused: "field-editor"))
    }

    /// The app answered the focus request with success and kept the text area focused (TextEdit, 2026-11-12).
    @Test func anotherElementKeepingTheFocusIsNotReached() {
        #expect(!reached("size", focused: "text"))
    }

    @Test func theWindowAroundTheRequestedElementHoldingTheFocusIsNotReached() {
        #expect(!reached("size", focused: "toolbar"))
        #expect(!reached("size", focused: "window"))
    }

    @Test func anAppThatNamesNoFocusedElementIsNotReached() {
        #expect(!reached("size", focused: nil))
    }
}
