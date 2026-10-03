import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

@MainActor
final class ProjectFilesTests: XCTestCase {
    private func change(_ path: String, _ state: String, _ status: String) -> JSONValue {
        .object(["path": .string(path), "state": .string(state), "status": .string(status)])
    }

    func testARowCarriesTheLetterOfItsChangeAndAFolderOneForWhatChangedUnderIt() {
        let checkout = GitCheckout(
            path: "/work/app", label: "app", kind: "root",
            status: .object([
                "repo": .bool(true), "root": .string("/work/app"),
                "files": .array([
                    change("src/transport/pool.ts", "staged", "M"),
                    change("src/transport/pool.ts", "unstaged", "M"),
                    change("src/List.tsx", "untracked", "?"),
                    change("src/old.ts", "unstaged", "D"),
                    change("src/merge.ts", "conflicted", "UU"),
                    change("assets/", "untracked", "?"),
                ]),
            ]))
        let marks = GitFileMarks([checkout])
        XCTAssertEqual(marks.mark(path: "/work/app/src/transport/pool.ts", directory: false), "M")
        XCTAssertEqual(marks.mark(path: "/work/app/src/List.tsx", directory: false), "A")
        XCTAssertEqual(marks.mark(path: "/work/app/src/old.ts", directory: false), "D")
        XCTAssertEqual(marks.mark(path: "/work/app/src/merge.ts", directory: false), "!")
        XCTAssertEqual(marks.mark(path: "/work/app/src/transport", directory: true), "M")
        XCTAssertEqual(marks.mark(path: "/work/app/src", directory: true), "M")
        XCTAssertEqual(marks.mark(path: "/work/app/assets", directory: true), "A")
        XCTAssertEqual(marks.mark(path: "/work/app/assets/hero.png", directory: false), "A")
        XCTAssertNil(marks.mark(path: "/work/app/src/main.tsx", directory: false))
        XCTAssertNil(marks.mark(path: "/work/app/docs", directory: true))
    }

    func testAStagedAdditionWithLaterEditsReadsAsNew() {
        let checkout = GitCheckout(
            path: "/w", label: "w", kind: "root",
            status: .object([
                "repo": .bool(true), "root": .string("/w"),
                "files": .array([change("a.ts", "unstaged", "M"), change("a.ts", "staged", "A")]),
            ]))
        XCTAssertEqual(GitFileMarks([checkout]).mark(path: "/w/a.ts", directory: false), "A")
    }

    func testTheDiffMarksAddedChangedAndRemovedLinesByTheirNumberInTheFile() {
        let diff = """
            diff --git a/pool.ts b/pool.ts
            --- a/pool.ts
            +++ b/pool.ts
            @@ -1,5 +1,6 @@
             import { a } from './a'
            -for (let i = 0; i < 10; i++) reconnect()
            +export const backoff = createBackoff({ max: 5 })
            +backoff.start()
             const b = 1
            -const c = 2
             const d = 3
            @@ -20,2 +21,3 @@
             end()
            +done()
             close()

            """
        let marks = FileLineChanges.parse(diff)
        XCTAssertEqual(marks[2], .modified)
        XCTAssertEqual(marks[3], .added)
        XCTAssertNil(marks[4])
        XCTAssertEqual(marks[5], .deleted)
        XCTAssertEqual(marks[22], .added)
        XCTAssertEqual(marks.count, 4)
    }

    func testANewFileIsAddedFromItsFirstLine() {
        let marks = FileLineChanges.parse("@@ -0,0 +1,2 @@\n+one\n+two\n")
        XCTAssertEqual(marks, [1: .added, 2: .added])
    }

    func testLinesTakenFromTheEndMarkTheLastLineThatIsLeft() {
        let marks = FileLineChanges.parse("@@ -1,3 +1,1 @@\n keep\n-gone\n-also gone\n")
        XCTAssertEqual(marks, [1: .deleted])
    }

    func testAFileOpenedFromTheProjectReadsItsChangesAgainstTheLastCommit() async {
        let machine = FilesMachine()
        let model = FileChangeMarksModel()
        await model.load(client: machine, path: "/work/app/src/pool.ts")
        XCTAssertEqual(model.change(at: 2), .modified)
        XCTAssertEqual(model.diff?.scope, "base")
        XCTAssertEqual(model.diff?.base, "HEAD")
        let asked = machine.sent.first { $0.type == "git.diff" }
        XCTAssertEqual(asked?.payload["path"], .string("src/pool.ts"))
        XCTAssertEqual(asked?.payload["cwd"], .string("/work/app"))

        await model.load(client: machine, path: "/work/app/src/List.tsx")
        XCTAssertEqual(model.change(at: 40), .added)
        XCTAssertEqual(model.diff?.scope, "worktree")

        await model.load(client: machine, path: "/work/app/src/main.tsx")
        XCTAssertTrue(model.isEmpty)
        XCTAssertNil(model.diff)
    }

    func testAMentionNamesThePathUnderTheProjectFolderOnly() {
        XCTAssertEqual(FilesMention.relative(folder: "/work/app", path: "/work/app/src/App.tsx"), "src/App.tsx")
        XCTAssertEqual(FilesMention.relative(folder: "/work/app/", path: "/work/app/src/"), "src")
        XCTAssertNil(FilesMention.relative(folder: "/work/app", path: "/work/app"))
        XCTAssertNil(FilesMention.relative(folder: "/work/app", path: "/work/application/a.ts"))
    }

    func testTheChatOpenedLastComesFirst() {
        let views: [JSONValue] = [
            .object(["id": .string("one"), "kind": .string("chat"), "name": .string("Refactor")]),
            .object([
                "id": .string("main"), "kind": .string("canvas"),
                "nodes": .array([.object(["id": .string("node"), "kind": .string("chat"), "title": .string("Review")])]
                ),
            ]),
            .object(["id": .string("two"), "kind": .string("chat"), "name": .string("Shopping list")]),
        ]
        let chats = FilesMention.chats(in: views, current: "two")
        XCTAssertEqual(chats.map(\.title), ["Shopping list", "Refactor", "Review"])
        XCTAssertEqual(chats.map(\.current), [true, false, false])
    }

    func testAMentionLandsInTheDraftOnScreenOrTheSavedOne() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let open = ChatComposition(machineID: "machine", chatID: "open", root: root)
        open.text = "Look at"
        await ChatDraftInbox.mention("src/App.tsx", machineID: "machine", chatID: "open", root: root)
        XCTAssertEqual(open.text, "Look at @src/App.tsx ")
        XCTAssertEqual(open.mentions, ["src/App.tsx"])

        await ChatDraftInbox.mention("src/List.tsx", machineID: "machine", chatID: "closed", root: root)
        let saved = try ChatDraftFiles(machineID: "machine", chatID: "closed", root: root).read()
        XCTAssertEqual(saved?.text, "@src/List.tsx ")
        XCTAssertEqual(saved?.mentions, ["src/List.tsx"])
    }

    func testFindInFilesGroupsTheHitsPerFileAndCutsTheLineAtTheHit() {
        let matches: [JSONValue] = [
            .object([
                "path": .string("src/a.ts"), "line": .number(3), "column": .number(6), "length": .number(7),
                "text": .string("const backoff = 1"),
            ]),
            .object([
                "path": .string("src/b.ts"), "line": .number(1), "column": .number(0), "length": .number(7),
                "text": .string("backoff()"),
            ]),
            .object([
                "path": .string("src/a.ts"), "line": .number(9), "column": .number(2), "length": .number(7),
                "text": .string("🙂 backoff"),
            ]),
        ]
        let groups = FileGrepModel.group(matches)
        XCTAssertEqual(groups.map(\.path), ["src/a.ts", "src/b.ts"])
        XCTAssertEqual(groups[0].hits.map(\.line), [3, 9])
        XCTAssertEqual(groups[0].hits[0].parts.match, "backoff")
        XCTAssertEqual(groups[0].hits[0].parts.before, "const ")
        XCTAssertEqual(groups[0].hits[1].parts.before, "🙂")
        XCTAssertEqual(groups[0].hits[1].parts.match, " backof")
    }

    func testFindInFilesSendsTheQueryWithItsOptions() async {
        let machine = FilesMachine()
        let model = FileGrepModel(cwd: "/work/app")
        model.query = "  backoff "
        model.wholeWord = true
        await model.search(client: machine)
        let asked = machine.sent.first { $0.type == "fs.grep" }
        XCTAssertEqual(asked?.payload["query"], .string("backoff"))
        XCTAssertEqual(asked?.payload["wholeWord"], .bool(true))
        XCTAssertNil(asked?.payload["regex"])
        XCTAssertEqual(model.groups.count, 1)
        XCTAssertEqual(model.answered, "backoff")

        model.query = ""
        await model.search(client: machine)
        XCTAssertTrue(model.groups.isEmpty)
        XCTAssertNil(model.answered)
    }

    func testAnEditIsWrittenOverTheVersionItWasReadAt() async {
        let machine = FilesMachine()
        let edit = FileEditModel()
        edit.begin(text: "one", mtime: 1000)
        edit.text = "two"
        let saved = await edit.save(client: machine, path: "/work/app/a.ts")
        XCTAssertTrue(saved)
        XCTAssertFalse(edit.editing)
        let write = machine.sent.first { $0.type == "fs.write" }
        XCTAssertEqual(write?.payload["expectedMtime"], .number(1000))
        XCTAssertEqual(write?.payload["text"], .string("two"))
        XCTAssertEqual(edit.mtime, 2000)
    }

    func testAFileThatMovedRefusesTheEditAndKeepsIt() async {
        let machine = FilesMachine()
        machine.stale = true
        let edit = FileEditModel()
        edit.begin(text: "one", mtime: 1000)
        edit.text = "two"
        let saved = await edit.save(client: machine, path: "/work/app/a.ts")
        XCTAssertFalse(saved)
        XCTAssertTrue(edit.stale)
        XCTAssertTrue(edit.editing)
        XCTAssertEqual(edit.text, "two")
    }
}

@MainActor private final class FilesMachine: MachineRequesting {
    var sent: [(type: String, payload: JSONValue)] = []
    var stale = false

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        switch type {
        case "git.status":
            return .object([
                "repo": .bool(true), "root": .string("/work/app"),
                "files": .array([
                    .object(["path": .string("src/pool.ts"), "state": .string("unstaged"), "status": .string("M")]),
                    .object(["path": .string("src/List.tsx"), "state": .string("untracked"), "status": .string("?")]),
                ]),
            ])
        case "git.diff":
            return .object(["path": .string("src/pool.ts"), "diff": .string("@@ -1,2 +1,2 @@\n a\n-b\n+B\n")])
        case "fs.grep":
            return .object([
                "matches": .array([
                    .object([
                        "path": .string("a.ts"), "line": .number(1), "column": .number(0), "length": .number(7),
                        "text": .string("backoff"),
                    ])
                ]),
                "files": .number(1), "truncated": .bool(false),
            ])
        case "fs.write":
            if stale {
                throw MachineClientError.server(code: "stale", message: "That file changed on disk since it was read")
            }
            return .object(["size": .number(3), "mtime": .number(2000)])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
