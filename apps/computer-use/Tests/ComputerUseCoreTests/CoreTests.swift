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
        #expect(OverlayConfig().pillText == "Ruimte is using your computer · Esc to stop")
        #expect(OverlayConfig.load(from: "/nonexistent/overlay.json") == OverlayConfig())
    }

    @Test func readsTranslatedWordsAndKeepsDefaultsForTheRest() throws {
        let data = Data(#"{"title": "Ruimte gebruikt je computer", "hint": ""}"#.utf8)
        let config = try JSONDecoder().decode(OverlayConfig.self, from: data)
        #expect(config.title == "Ruimte gebruikt je computer")
        #expect(config.hint == "Esc to stop")
        #expect(config.accentComponents == nil)
    }

    @Test func parsesAccent() {
        #expect(RGB(hex: "#FF8000") == RGB(red: 1, green: 128.0 / 255, blue: 0))
        #expect(RGB(hex: "00ff00") == RGB(red: 0, green: 1, blue: 0))
        #expect(RGB(hex: "#fff") == nil)
        #expect(RGB(hex: "#GG0000") == nil)
        #expect(RGB(hex: "+12345") == nil)
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
