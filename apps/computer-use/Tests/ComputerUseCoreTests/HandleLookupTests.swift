import ComputerUseCore
import Testing

struct HandleLookupTests {
    private let save = ElementSignature(role: "AXButton", label: "Save", identifier: nil)
    private let row = ElementSignature(role: "AXButton", label: "Delete", identifier: nil)
    private let group = ElementSignature(role: "AXGroup", label: nil, identifier: nil)

    @Test func usesAnOldElementThatStillAnswers() {
        #expect(HandleLookup.resolve(retired: save, alive: true, current: [:]) == .retired)
    }

    @Test func movesToTheOneElementThatLooksTheSame() {
        let current = [8: save, 9: row]
        #expect(HandleLookup.resolve(retired: save, alive: false, current: current) == .moved(to: 8))
    }

    @Test func givesUpWhenMoreThanOneElementLooksTheSame() {
        let current = [8: row, 9: row]
        #expect(HandleLookup.resolve(retired: row, alive: false, current: current) == .gone(row))
    }

    @Test func neverGuessesAnElementWithoutLabelOrIdentifier() {
        #expect(HandleLookup.resolve(retired: group, alive: false, current: [3: group]) == .gone(group))
        #expect(HandleLookup.resolve(retired: nil, alive: false, current: [3: save]) == .gone(nil))
    }

    @Test func namesTheElementAsAStateLineDoes() {
        #expect(save.shown == "Button \"Save\"")
        #expect(group.shown == "Group")
    }
}
