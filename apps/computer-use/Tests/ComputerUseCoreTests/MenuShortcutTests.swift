import ComputerUseCore
import Testing

struct MenuShortcutTests {
    @Test func writesACommandComboAsAMenuListsIt() {
        #expect(MenuShortcut.canonical("cmd+n") == "cmd+n")
        #expect(MenuShortcut.canonical("Shift+Command+S") == "shift+cmd+s")
        #expect(MenuShortcut.canonical("cmd+alt+ctrl+1") == "ctrl+option+cmd+1")
        #expect(MenuShortcut.canonical("cmd+,") == "cmd+,")
    }

    @Test func leavesKeysWithoutCommandOrANamedKeyAlone() {
        #expect(MenuShortcut.canonical("shift+tab") == nil)
        #expect(MenuShortcut.canonical("return") == nil)
        #expect(MenuShortcut.canonical("cmd+return") == nil)
        #expect(MenuShortcut.canonical("cmd+hyper+k") == nil)
    }
}
