import Foundation
import XCTest

/// Voice's microphone is in Debug builds only until its use is decided: no Release build, so nothing on TestFlight or
/// the App Store, declares it. Reads the sources, since a test only ever runs a Debug build; the build phase
/// "Release declares no microphone" checks the built Info.plist of every Release build as well.
final class MicrophoneDeclarationTests: XCTestCase {
    private static let key = "NSMicrophoneUsageDescription"
    private static let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()

    private static func source(_ path: String) throws -> String {
        try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
    }

    func testOnlyTheDebugConfigurationOfTheAppDeclaresTheMicrophone() throws {
        let project = try Self.source("Ruimte.xcodeproj/project.pbxproj")
        let configuration = try NSRegularExpression(
            pattern: #"isa = XCBuildConfiguration;\s*buildSettings = \{(.*?)\n\t\t\t\};\s*name = (\w+);"#,
            options: [.dotMatchesLineSeparators])
        let range = NSRange(project.startIndex..., in: project)
        var declaring: [String] = []
        for match in configuration.matches(in: project, range: range) {
            guard let settings = Range(match.range(at: 1), in: project),
                let name = Range(match.range(at: 2), in: project)
            else { continue }
            if project[settings].contains("INFOPLIST_KEY_\(Self.key)") { declaring.append(String(project[name])) }
        }
        XCTAssertEqual(declaring, ["Debug"], "Only the app's Debug configuration declares the microphone")
    }

    func testTheSpecAndThePlistLeaveReleaseWithoutAMicrophone() throws {
        let spec = try Self.source("project.yml")
        let lines = spec.components(separatedBy: "\n")
        let declaring = lines.indices.filter { lines[$0].contains("INFOPLIST_KEY_\(Self.key)") }
        XCTAssertEqual(declaring.count, 1, "project.yml declares the microphone once")
        let configuration = lines[..<(declaring.first ?? 0)].last {
            $0.hasSuffix("Debug:") || $0.hasSuffix("Release:")
        }
        XCTAssertEqual(configuration?.trimmingCharacters(in: .whitespaces), "Debug:")
        let plist = try Self.source("App/Info.plist")
        XCTAssertFalse(plist.contains(Self.key), "The shared Info.plist names no microphone")
        XCTAssertTrue(spec.contains("Release declares no microphone"), "The build phase that checks a Release build")
    }

    func testTheCameraAndTheBackgroundModesStay() throws {
        let plist = try Self.source("App/Info.plist")
        XCTAssertTrue(plist.contains("NSCameraUsageDescription"))
        XCTAssertTrue(plist.contains("<string>remote-notification</string>"))
        XCTAssertTrue(plist.contains("<string>fetch</string>"))
        XCTAssertTrue(plist.contains("<string>audio</string>"), "Voice goes on in the background and on a locked screen")
    }

    func testTheMicrophonePromptHasItsWordsInBothLanguages() throws {
        let catalog = try Self.source("App/InfoPlist.xcstrings")
        let root = try JSONSerialization.jsonObject(with: Data(catalog.utf8)) as? [String: Any]
        let strings = try XCTUnwrap(root?["strings"] as? [String: Any])
        let entry = try XCTUnwrap(strings[Self.key] as? [String: Any])
        let localizations = try XCTUnwrap(entry["localizations"] as? [String: Any])
        XCTAssertNotNil(localizations["en"])
        XCTAssertNotNil(localizations["nl"])
    }

    #if DEBUG
    func testThisDebugBuildDeclaresTheMicrophone() {
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: Self.key))
    }
    #endif
}
