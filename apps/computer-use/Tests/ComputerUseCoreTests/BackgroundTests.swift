import ComputerUseCore
import CoreGraphics
import Foundation
import Testing

struct WindowStackTests {
    private let helper: Int32 = 99

    @Test func aClickLandsOnTheFrontWindowUnderIt() {
        let windows = [
            StackedWindow(id: 1, pid: helper, layer: 1000, frame: CGRect(x: 0, y: 0, width: 2000, height: 1200)),
            StackedWindow(id: 2, pid: 10, layer: 0, frame: CGRect(x: 100, y: 100, width: 300, height: 300)),
            StackedWindow(id: 3, pid: 20, layer: 0, frame: CGRect(x: 0, y: 0, width: 800, height: 600)),
        ]
        #expect(WindowStack.owner(at: CGPoint(x: 200, y: 200), in: windows, ignoring: helper) == 10)
        #expect(WindowStack.owner(at: CGPoint(x: 600, y: 500), in: windows, ignoring: helper) == 20)
        #expect(WindowStack.owner(at: CGPoint(x: 1500, y: 900), in: windows, ignoring: helper) == nil)
    }

    @Test func aWindowIsCoveredOnlyWhenOtherAppsHideAllOfIt() {
        let target = StackedWindow(id: 7, pid: 20, layer: 0, frame: CGRect(x: 100, y: 100, width: 400, height: 300))
        let left = StackedWindow(id: 1, pid: 10, layer: 0, frame: CGRect(x: 0, y: 0, width: 300, height: 500))
        let right = StackedWindow(id: 2, pid: 11, layer: 0, frame: CGRect(x: 300, y: 50, width: 300, height: 450))
        #expect(WindowStack.isCovered(7, in: [left, right, target]))
        #expect(!WindowStack.isCovered(7, in: [left, target]))
        #expect(!WindowStack.isCovered(7, in: [target, left, right]))
    }

    @Test func itsOwnWindowsAndPanelsAboveTheNormalLayerDoNotCover() {
        let target = StackedWindow(id: 7, pid: 20, layer: 0, frame: CGRect(x: 100, y: 100, width: 400, height: 300))
        let own = StackedWindow(id: 1, pid: 20, layer: 0, frame: CGRect(x: 0, y: 0, width: 800, height: 800))
        let panel = StackedWindow(id: 2, pid: 11, layer: 25, frame: CGRect(x: 0, y: 0, width: 800, height: 800))
        let clear = StackedWindow(id: 3, pid: 12, layer: 0, frame: CGRect(x: 0, y: 0, width: 800, height: 800), alpha: 0)
        #expect(!WindowStack.isCovered(7, in: [own, panel, clear, target]))
    }

    @Test func aSliverUnderAPointStillCountsAsCovered() {
        let frame = CGRect(x: 0, y: 0, width: 100, height: 100)
        #expect(WindowStack.isCovered(frame, by: [CGRect(x: 0, y: 0, width: 100, height: 99.5)]))
        #expect(!WindowStack.isCovered(frame, by: [CGRect(x: 0, y: 0, width: 100, height: 90)]))
    }
}

struct ValueMatchTests {
    @Test func textHasToMatchExactly() {
        #expect(ValueMatch.holds("hello", wanted: "hello", numeric: false))
        #expect(!ValueMatch.holds("hell", wanted: "hello", numeric: false))
        #expect(!ValueMatch.holds(nil, wanted: "", numeric: false))
    }

    @Test func numbersMatchByValue() {
        #expect(ValueMatch.holds("0.5", wanted: ".5", numeric: true))
        #expect(ValueMatch.holds("1", wanted: "on", numeric: true))
        #expect(ValueMatch.holds("0", wanted: "false", numeric: true))
        #expect(!ValueMatch.holds("40", wanted: "50", numeric: true))
        #expect(ValueMatch.number("maybe") == nil)
    }
}

struct BackgroundWordsTests {
    @Test func editCommandsNeedTheKeyWindow() throws {
        for name in ["cmd+a", "cmd+c", "cmd+v", "cmd+x", "cmd+z", "cmd+shift+z"] {
            #expect(try KeyCombo.parse(name).editsFocusedText, "\(name)")
        }
        for name in ["cmd+shift+m", "cmd+n", "a", "return", "ctrl+a", "cmd+option+c", "shift+tab"] {
            #expect(try !KeyCombo.parse(name).editsFocusedText, "\(name)")
        }
    }

    @Test func needsFrontSaysHowToGoOn() {
        let error = AgentError.needsFront("A drag needs the real pointer, and so the app in front")
        #expect(error.code == "needs-front")
        #expect(error.message.hasPrefix("A drag needs the real pointer, and so the app in front. Call again with --front"))
    }

    @Test func theBarNamesTheAppInTheBackground() throws {
        let config = OverlayConfig()
        #expect(config.title(background: nil) == "Ruimte is using your computer")
        #expect(config.title(background: "Notes") == "Ruimte is working in Notes in the background")
        #expect(config.menuTitle(background: "Notes") == "Ruimte is using Notes in the background")
        let dutch = try JSONDecoder().decode(OverlayConfig.self, from: Data(#"{"backgroundTitle": "Ruimte werkt op de achtergrond in {app}"}"#.utf8))
        #expect(dutch.title(background: "Notities") == "Ruimte werkt op de achtergrond in Notities")
    }
}
