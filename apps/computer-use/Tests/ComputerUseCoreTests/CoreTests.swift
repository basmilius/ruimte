import ComputerUseCore
import CoreGraphics
import Foundation
import Testing

struct MenuPathTests {
    @Test func splitsAndTrimsSteps() {
        #expect(MenuPath.steps("File > Save As…") == ["File", "Save As…"])
        #expect(MenuPath.steps(" Edit >> Find > ") == ["Edit", "Find"])
        #expect(MenuPath.steps(" > ").isEmpty)
    }

    @Test func matchesWithoutCaseEllipsisOrFormatCharacters() {
        #expect(MenuPath.matches("Save As…", "save as"))
        #expect(MenuPath.matches("Export...", "Export"))
        #expect(MenuPath.matches("Hy\u{00AD}phen", "hyphen"))
        #expect(!MenuPath.matches("Save", "Save As"))
    }
}

struct CaptureResultTests {
    @Test func mapsPixelsToScreenPoints() {
        let capture = CaptureResult(path: "", pixelWidth: 1280, pixelHeight: 800, origin: CGPoint(x: 100, y: 50), pointSize: CGSize(width: 640, height: 400))
        #expect(capture.scale == 2)
        #expect(capture.screenPoint(pixelX: 0, pixelY: 0) == CGPoint(x: 100, y: 50))
        #expect(capture.screenPoint(pixelX: 640, pixelY: 200) == CGPoint(x: 420, y: 150))
    }

    @Test func downscaledCaptureStretchesBack() {
        let capture = CaptureResult(path: "", pixelWidth: 1280, pixelHeight: 720, origin: CGPoint(x: -1920, y: 0), pointSize: CGSize(width: 1920, height: 1080))
        let point = capture.screenPoint(pixelX: 1280, pixelY: 720)
        #expect(abs(point.x - 0) < 0.0001)
        #expect(abs(point.y - 1080) < 0.0001)
    }
}

struct OverlayConfigTests {
    @Test func defaultsAreEnglish() {
        let config = OverlayConfig()
        #expect(config.title == "Ruimte is using your computer")
        #expect(config.menuTitle == "Ruimte is using this Mac")
        #expect(config.label(for: .think) == "Working")
        #expect(config.label(for: .idle) == nil)
        #expect(OverlayConfig.load(from: "/nonexistent/overlay.json") == config)
    }

    @Test func readsTranslatedWordsAndKeepsDefaultsForTheRest() throws {
        let data = Data(#"{"title": "Ruimte gebruikt je computer", "pause": "", "labels": {"think": "Bezig", "done": ""}}"#.utf8)
        let config = try JSONDecoder().decode(OverlayConfig.self, from: data)
        #expect(config.title == "Ruimte gebruikt je computer")
        #expect(config.pause == "Pause")
        #expect(config.label(for: .think) == "Bezig")
        #expect(config.label(for: .done) == "Done")
        #expect(config.accentComponents == nil)
    }

    @Test func fillsTheTargetIntoASteps() {
        let config = OverlayConfig()
        #expect(config.step(for: .click, target: "Export") == "Clicking Export")
        #expect(config.step(for: .click, target: nil) == "Clicking")
        #expect(config.step(for: .think, target: "Export") == "Deciding what to do next")
    }

    @Test func parsesAccent() {
        #expect(RGB(hex: "#FF8000") == RGB(red: 1, green: 128.0 / 255, blue: 0))
        #expect(RGB(hex: "00ff00") == RGB(red: 0, green: 1, blue: 0))
        #expect(RGB(hex: "#fff") == nil)
        #expect(RGB(hex: "#GG0000") == nil)
        #expect(RGB(hex: "+12345") == nil)
    }
}

struct SessionControlTests {
    @Test func pausingHoldsTheClockAndRefuses() {
        var control = SessionControl()
        control.begin(at: 100)
        control.show(.click)
        #expect(control.refusal == nil)
        control.pause(at: 110)
        #expect(control.shownState == .paused)
        #expect(control.refusal?.message == AgentError.paused.message)
        #expect(control.elapsed(at: 200) == 10)
        control.resume(at: 200)
        #expect(control.shownState == .click)
        #expect(control.elapsed(at: 205) == 15)
    }

    @Test func takingOverRefusesWithItsOwnMessage() {
        var control = SessionControl()
        control.begin(at: 0)
        #expect(control.acceptsTakeover)
        control.takeOver(at: 5)
        #expect(control.shownState == .takeover)
        #expect(control.refusal?.message == AgentError.takenOver.message)
        #expect(!control.acceptsTakeover)
        control.togglePause(at: 6)
        #expect(control.mode == .running)
    }

    @Test func waitingOnThePersonIsNotTakingOver() {
        var control = SessionControl()
        control.begin(at: 0)
        control.show(.waiting)
        #expect(!control.acceptsTakeover)
        control.show(.think)
        #expect(control.acceptsTakeover)
    }

    @Test func stopEndsTheSessionUntilCleared() {
        var control = SessionControl()
        control.begin(at: 0)
        control.stop(at: 3)
        #expect(!control.isActive)
        #expect(control.refusal?.message == AgentError.stopped.message)
        control.clearStop()
        #expect(control.refusal == nil)
    }

    @Test func refusalsCarryAStableCode() {
        #expect(AgentError.paused.code == "paused")
        #expect(AgentError.takenOver.code == "taken-over")
        #expect(AgentError.stopped.code == "stopped")
        #expect(AgentError("element 3 is gone").code == nil)
    }

    @Test func summarizesTheSessionForDoctor() {
        var control = SessionControl()
        #expect(control.summary["active"] as? Bool == false)
        control.begin(at: 0)
        control.takeOver(at: 1)
        #expect(control.summary["active"] as? Bool == true)
        #expect(control.summary["mode"] as? String == "takenOver")
        control.stop(at: 2)
        #expect(control.summary["stopped"] as? Bool == true)
        #expect(control.summary["mode"] as? String == "running")
    }

    @Test func formatsTheClock() {
        #expect(SessionControl.clock(134) == "02:14")
        #expect(SessionControl.clock(3725) == "1:02:05")
        #expect(SessionControl.clock(-4) == "00:00")
    }
}

struct HomeTests {
    @Test func explicitThenEnvironmentThenDefault() {
        let environment = ["RUIMTE_HOME": "/tmp/from-env"]
        #expect(Home.resolve(explicit: "/tmp/explicit", environment: environment, development: false, userHome: "/Users/x").path == "/tmp/explicit")
        #expect(Home.resolve(explicit: nil, environment: environment, development: true, userHome: "/Users/x").path == "/tmp/from-env")
        #expect(Home.resolve(explicit: nil, environment: [:], development: false, userHome: "/Users/x").path == "/Users/x/.ruimte")
        #expect(Home.resolve(explicit: "", environment: [:], development: true, userHome: "/Users/x").path == "/Users/x/.ruimte-dev")
    }

    @Test func filesSitInsideTheHome() {
        let home = Home(path: "/Users/x/.ruimte/")
        #expect(home.socketPath == "/Users/x/.ruimte/computer-use/agent.sock")
        #expect(home.secretPath == "/Users/x/.ruimte/local.key")
        #expect(home.overlayConfigPath == "/Users/x/.ruimte/computer-use/overlay.json")
    }

    @Test func findsTheHomeArgumentAmongOthers() {
        #expect(Home.argument(in: ["/app", "-psn_0_1", "--home", "/tmp/h"]) == "/tmp/h")
        #expect(Home.argument(in: ["/app", "--home=/tmp/h"]) == "/tmp/h")
        #expect(Home.argument(in: ["/app", "--home"]) == nil)
    }

    @Test func onlyTheDevelopmentBundleIsDevelopment() {
        #expect(Home.isDevelopment(bundleIdentifier: "app.ruimte.computer-use.dev"))
        #expect(!Home.isDevelopment(bundleIdentifier: "app.ruimte.computer-use"))
        #expect(!Home.isDevelopment(bundleIdentifier: nil))
    }
}

struct LocalSecretTests {
    @Test func comparesWholeSecrets() {
        #expect(LocalSecret.matches("abc", "abc"))
        #expect(!LocalSecret.matches("abc", "abd"))
        #expect(!LocalSecret.matches("", "abc"))
        #expect(!LocalSecret.matches("abc", "abcd"))
    }

    @Test func readsTheTrimmedFileAndNothingForAnEmptyOne() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: directory)
        }
        let file = directory.appendingPathComponent("local.key")
        try "secret-value\n".write(to: file, atomically: true, encoding: .utf8)
        #expect(LocalSecret.read(at: file.path) == "secret-value")
        try "\n".write(to: file, atomically: true, encoding: .utf8)
        #expect(LocalSecret.read(at: file.path) == nil)
        #expect(LocalSecret.read(at: directory.appendingPathComponent("missing").path) == nil)
    }
}
