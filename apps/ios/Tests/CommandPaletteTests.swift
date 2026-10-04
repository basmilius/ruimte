import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class CommandPaletteTests: XCTestCase {
    private func machine(_ id: String) -> Machine {
        Machine(id: id, name: id.capitalized, icon: nil, publicKey: "key-\(id)", brokerUrl: nil, lastSeenAt: nil)
    }

    private func row(_ machine: Machine, _ id: String, name: String, scratch: Bool = false) -> UnifiedProjectRow {
        var summary: [String: JSONValue] = [
            "projectId": .string(id), "name": .string(name), "folder": .string("/code/\(id)"),
        ]
        if scratch { summary["scratch"] = .bool(true) }
        return UnifiedProjectRow(machine: machine, summary: .object(summary), connected: true)
    }

    func testEveryTypedWordHasToAppearInAnyOrder() {
        XCTAssertTrue(PaletteRanking.matches("terminal recept", "New terminal in Recept Maker"))
        XCTAssertFalse(PaletteRanking.matches("terminal portfolio", "New terminal in Recept Maker"))
        XCTAssertFalse(PaletteRanking.matches("   ", "Anything"))
    }

    func testANameThatStartsWithTheQueryGoesFirstThenWordStarts() {
        let names = ["Add a machine", "pool.test.ts", "Spool", "pool.ts", "Connection pool"]
        XCTAssertEqual(
            PaletteRanking.rank(names, query: "pool", text: { $0 }),
            ["pool.test.ts", "pool.ts", "Connection pool", "Spool"])
        XCTAssertEqual(PaletteRanking.score("new term", "New terminal in App"), 0)
        XCTAssertEqual(PaletteRanking.score("term new", "New terminal in App"), 1)
        XCTAssertEqual(PaletteRanking.score("erm", "New terminal in App"), 2)
        XCTAssertNil(PaletteRanking.score("git", "New terminal in App"))
    }

    func testWhatOnlyTheExtraTextHoldsComesLast() {
        let items = [("README", "Recept Maker"), ("Recept notes", "Notes")]
        XCTAssertEqual(
            PaletteRanking.rank(items, query: "recept", text: \.0, extra: \.1).map(\.0), ["Recept notes", "README"])
    }

    func testHighlightsCoverEachWordOnce() {
        let title = "pool.test.ts"
        let ranges = PaletteRanking.highlights("POOL ts", in: title)
        XCTAssertEqual(ranges.map { String(title[$0]) }, ["pool", "ts"])
    }

    func testCommandsCoverEveryOpenProjectAndNameMachinesOnlyWhenSeveral() {
        let mac = machine("mac")
        let one = PaletteCommands.all(
            projects: [row(mac, "app", name: "Recept Maker"), row(mac, "chats", name: "Chats", scratch: true)],
            machines: [mac], appearance: "system")
        let titles = one.map(\.title)
        XCTAssertTrue(titles.contains("New chat"))
        XCTAssertTrue(titles.contains("New terminal in Recept Maker"))
        XCTAssertTrue(titles.contains("Open a folder as a project…"))
        XCTAssertFalse(titles.contains { $0.contains("Chats") })
        XCTAssertFalse(titles.contains("Follow the system appearance"))
        XCTAssertTrue(titles.contains("Use the dark appearance"))
        XCTAssertEqual(
            PaletteCommands.featured(one).map(\.title), ["New chat", "Recently closed", "Add a machine", "Settings"])

        let studio = machine("studio")
        let several = PaletteCommands.all(projects: [], machines: [mac, studio], appearance: "dark").map(\.title)
        XCTAssertTrue(several.contains("New chat on Studio"))
        XCTAssertTrue(several.contains("Usage of Mac"))
        XCTAssertTrue(several.contains("Open a folder on Studio…"))
    }

    @MainActor
    func testFileSearchKeepsPartialResultsAndReportsTheProjectThatFailed() async {
        let files = PaletteFiles()
        let success = PaletteMachine()
        let failed = PaletteMachine()
        failed.fail = true
        await files.search(
            "pool", projects: [row(machine("mac"), "app", name: "App"), row(machine("other"), "api", name: "API")]
        ) {
            $0.id == "mac" ? success : failed
        }
        XCTAssertEqual(files.results.map(\.path), ["src/pool.ts"])
        XCTAssertEqual(files.failures.map(\.name), ["API"])
        XCTAssertFalse(files.searching)
        files.invalidate("")
        XCTAssertTrue(files.results.isEmpty)
        XCTAssertTrue(files.failures.isEmpty)
        XCTAssertFalse(files.searching)
    }

    func testAFileIsPlacedFromItsProjectFolderDown() {
        let file = PaletteFile(
            project: UnifiedProjectRow.ID(machineID: "mac", projectID: "app"), projectName: "Recept Maker",
            path: "src/transport/pool.ts", folder: "/Users/bas/code/recept-maker")
        XCTAssertEqual(file.name, "pool.ts")
        XCTAssertEqual(file.place, "recept-maker/src/transport")
        XCTAssertEqual(file.absolutePath, "/Users/bas/code/recept-maker/src/transport/pool.ts")
        let top = PaletteFile(project: file.project, projectName: "", path: "README.md", folder: "/code/app/")
        XCTAssertEqual(top.place, "app")
        XCTAssertEqual(top.absolutePath, "/code/app/README.md")
    }
}

@MainActor private final class PaletteMachine: MachineRequesting {
    var fail = false

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        if fail { throw MachineClientError.server(code: "offline", message: "Offline") }
        return .object(["files": .array([.string("src/pool.ts")])])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
