import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class MachinePathTests: XCTestCase {
    private let windows = MachinePath(platform: "win32")
    private let posix = MachinePath(platform: "darwin")

    func testOnlyWin32HasDrives() {
        XCTAssertEqual(MachinePath(platform: "win32").style, .windows)
        XCTAssertEqual(MachinePath(platform: "darwin").style, .posix)
        XCTAssertEqual(MachinePath(platform: "linux").style, .posix)
        XCTAssertEqual(MachinePath(platform: nil).style, .posix)
        XCTAssertEqual(windows.separator, "\\")
        XCTAssertEqual(posix.separator, "/")
    }

    func testAPageWithOnlyAPathReadsADriveOrAShareAsWindows() {
        XCTAssertEqual(MachinePath(inferring: "C:\\Users\\bas").style, .windows)
        XCTAssertEqual(MachinePath(inferring: "d:/Work").style, .windows)
        XCTAssertEqual(MachinePath(inferring: "C:").style, .windows)
        XCTAssertEqual(MachinePath(inferring: "\\\\server\\share\\dir").style, .windows)
        XCTAssertEqual(MachinePath(inferring: "/Users/bas").style, .posix)
        XCTAssertEqual(MachinePath(inferring: "~").style, .posix)
        XCTAssertEqual(MachinePath(inferring: "Cx/dir").style, .posix)
    }

    func testNameAndParentInBothStyles() {
        XCTAssertEqual(posix.name("/Users/bas/app"), "app")
        XCTAssertEqual(posix.parent("/Users/bas/app"), "/Users/bas")
        XCTAssertEqual(posix.parent("/Users"), "/")
        XCTAssertEqual(posix.parent("/"), "/")
        XCTAssertEqual(posix.name("/"), "/")
        XCTAssertEqual(posix.name("/Users/bas/"), "bas")

        XCTAssertEqual(windows.name("C:\\Users\\bas\\app"), "app")
        XCTAssertEqual(windows.parent("C:\\Users\\bas\\app"), "C:\\Users\\bas")
        XCTAssertEqual(windows.parent("C:\\Users"), "C:\\")
        XCTAssertEqual(windows.parent("C:\\"), "C:\\")
        XCTAssertEqual(windows.name("C:\\"), "C:\\")
        XCTAssertEqual(windows.name("C:\\Users\\bas\\"), "bas")
    }

    func testAWindowsMachineAcceptsEitherSeparatorAndWritesBackslashes() {
        XCTAssertEqual(windows.name("C:/Users/bas"), "bas")
        XCTAssertEqual(windows.parent("C:/Users/bas"), "C:\\Users")
    }

    func testAShareIsItsOwnRoot() {
        XCTAssertEqual(windows.parent("\\\\server\\share\\dir"), "\\\\server\\share\\")
        XCTAssertEqual(windows.parent("\\\\server\\share\\"), "\\\\server\\share\\")
        XCTAssertEqual(windows.name("\\\\server\\share\\dir"), "dir")
    }

    func testBelowMeansTheFolderItselfOrAnythingInsideIt() {
        XCTAssertTrue(posix.isBelow("/code/app", root: "/code"))
        XCTAssertTrue(posix.isBelow("/code", root: "/code"))
        XCTAssertFalse(posix.isBelow("/codex/app", root: "/code"))
        XCTAssertFalse(posix.isBelow("/code", root: "/code/app"))
        XCTAssertTrue(posix.isBelow("/code/app", root: "/"))
        XCTAssertFalse(posix.isBelow("/Code/app", root: "/code"))

        XCTAssertTrue(windows.isBelow("C:\\code\\app", root: "C:\\code"))
        XCTAssertTrue(windows.isBelow("C:\\code", root: "C:\\code\\"))
        XCTAssertFalse(windows.isBelow("C:\\codex\\app", root: "C:\\code"))
        XCTAssertFalse(windows.isBelow("D:\\code\\app", root: "C:\\code"))
        XCTAssertTrue(windows.isBelow("c:\\Code\\App", root: "C:\\code"))
        XCTAssertTrue(windows.isBelow("C:/code/app", root: "C:\\code"))
        XCTAssertTrue(windows.isBelow("C:\\code\\app", root: "C:\\"))
    }

    func testTheExtensionIsTheLowercasedEndOfTheLastSegmentOnly() {
        XCTAssertEqual(posix.fileExtension("/a/b/Photo.JPG"), "jpg")
        XCTAssertEqual(windows.fileExtension("C:\\dir.d\\Photo.PNG"), "png")
        XCTAssertEqual(windows.fileExtension("C:\\dir.d\\readme"), "")
        XCTAssertEqual(posix.fileExtension("/home/bas/.bashrc"), "")
    }

    func testTheExampleIsInTheStyleOfTheMachine() {
        XCTAssertEqual(windows.example, "C:\\Projects")
        XCTAssertEqual(posix.example, "~/projects")
    }
}

@MainActor
final class MachineStartFolderTests: XCTestCase {
    func testFilesStartAtTheStartFolderTheMachineStillHas() async throws {
        let machine = StartMachine(startFolder: "D:\\Work", platform: "win32")
        let folder = try await MachinePath.startFolder(client: machine)
        XCTAssertEqual(folder, "D:\\Work")
        XCTAssertEqual(machine.browsed, ["D:\\Work\\"])
    }

    func testFilesStartAtTheHomeFolderTheMachineNamesWhenNoneIsSet() async throws {
        let machine = StartMachine(startFolder: "", platform: "win32")
        let folder = try await MachinePath.startFolder(client: machine)
        XCTAssertEqual(folder, "C:\\Users\\bas")
        XCTAssertEqual(machine.browsed, ["~/"])
    }

    func testAStartFolderThatIsGoneFallsBackToHome() async throws {
        let machine = StartMachine(startFolder: "~/gone", platform: "darwin", existing: false)
        let folder = try await MachinePath.startFolder(client: machine)
        XCTAssertEqual(folder, "/Users/bas")
        XCTAssertEqual(machine.browsed, ["~/gone/", "~/"])
    }

    func testAMachineWithoutTheSettingStartsAtHome() async throws {
        let machine = StartMachine(startFolder: nil, platform: "darwin")
        let folder = try await MachinePath.startFolder(client: machine)
        XCTAssertEqual(folder, "/Users/bas")
    }
}

@MainActor private final class StartMachine: MachineRequesting {
    let startFolder: String?
    let platform: String
    let existing: Bool
    var browsed: [String] = []

    init(startFolder: String?, platform: String, existing: Bool = true) {
        self.startFolder = startFolder
        self.platform = platform
        self.existing = existing
    }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        switch type {
        case .endpointInfo:
            var info: [String: JSONValue] = ["platform": .string(platform)]
            if let startFolder { info["startFolder"] = .string(startFolder) }
            return EndpointWire.info(info)
        case .fsBrowse:
            let partial = payload["partialPath"]?.stringValue ?? ""
            browsed.append(partial)
            if partial.hasPrefix("~") {
                let home = platform == "win32" ? "C:\\Users\\bas" : "/Users/bas"
                return .object([
                    "parentPath": .string(existing || partial == "~/" ? home : home + "/gone"),
                    "entries": .array([]), "exists": .bool(existing || partial == "~/"),
                ])
            }
            return .object([
                "parentPath": .string(String(partial.dropLast())), "entries": .array([]), "exists": .bool(existing),
            ])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
