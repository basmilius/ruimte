import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class GitConflictTests: XCTestCase {
    private func answer(
        path: String = "a.ts", base: String? = "a\nb\nc\n", ours: String? = "a\nours\nc\n",
        theirs: String? = "a\ntheirs\nc\n", kind: String = "text", hash: String = "h1"
    ) -> JSONValue {
        .object([
            "path": .string(path), "kind": .string(kind), "base": base.map { .string($0) } ?? .null,
            "ours": ours.map { .string($0) } ?? .null, "theirs": theirs.map { .string($0) } ?? .null,
            "hash": .string(hash),
        ])
    }

    func testAFileStartsWithEveryConflictOpenAndOurSideInPlace() {
        let file = GitConflictFile(answer: answer())
        let draft = GitConflictDraft()
        XCTAssertFalse(file.whole)
        XCTAssertEqual(file.conflictIndexes, [1])
        XCTAssertEqual(draft.open(in: file), [1])
        XCTAssertEqual(draft.content(of: file), "a\nours\nc\n")
    }

    func testAnAnswerIsWrittenInTheFilesOwnLineEndings() {
        let file = GitConflictFile(answer: answer(base: "a\r\nb\r\nc", ours: "a\r\nours\r\nc", theirs: "a\r\ntheirs\r\nc"))
        var draft = GitConflictDraft()
        draft.answers[1] = GitBlockAnswer(lines: ["ours", "theirs"])
        XCTAssertTrue(draft.open(in: file).isEmpty)
        XCTAssertEqual(draft.content(of: file), "a\r\nours\r\ntheirs\r\nc")
    }

    func testEmptyingEveryLineWritesAnEmptyFile() {
        let file = GitConflictFile(answer: answer(base: "b\n", ours: "ours\n", theirs: "theirs\n"))
        var draft = GitConflictDraft()
        draft.answers[0] = GitBlockAnswer(lines: [])
        XCTAssertEqual(draft.content(of: file), "")
        draft.answers[0] = GitBlockAnswer(lines: [""])
        XCTAssertEqual(draft.content(of: file), "")
    }

    func testAFileWithoutTwoTextSidesIsAChoiceBetweenWholeSides() {
        XCTAssertTrue(GitConflictFile(answer: answer(ours: nil, kind: "deleted-by-us")).whole)
        XCTAssertTrue(GitConflictFile(answer: answer(kind: "binary")).whole)
        XCTAssertTrue(GitConflictFile(answer: answer(theirs: nil)).whole)
    }

    func testOnlyProposalsForTheSameStretchAreUsed() {
        let file = GitConflictFile(answer: answer())
        let print = ThreeWayMerge.fingerprint(file.blocks[1])
        let usable = GitConflictModel.usable(
            file,
            answers: [
                .object(["index": .number(1), "fingerprint": .string(print), "lines": .array([.string("merged")])]),
                .object(["index": .number(1), "fingerprint": .string("00000000"), "lines": .array([.string("stale")])]),
                .object(["index": .number(0), "fingerprint": .string(ThreeWayMerge.fingerprint(file.blocks[0])), "lines": .array([])]),
                .object(["index": .number(9), "fingerprint": .string(print), "lines": .array([])]),
            ])
        XCTAssertEqual(usable.map(\.index), [1])
        XCTAssertEqual(usable.first?.lines, ["merged"])
    }

    func testAProposalNeverOverwritesWhatAPersonWrote() {
        var draft = GitConflictDraft()
        draft.answers[1] = GitBlockAnswer(lines: ["mine"])
        draft.answers[3] = GitBlockAnswer(lines: ["earlier proposal"], byAgent: true)
        draft.propose([(1, ["agent"]), (3, ["newer proposal"]), (5, ["fresh"])])
        XCTAssertEqual(draft.answers[1], GitBlockAnswer(lines: ["mine"]))
        XCTAssertEqual(draft.answers[3], GitBlockAnswer(lines: ["newer proposal"], byAgent: true))
        XCTAssertEqual(draft.answers[5], GitBlockAnswer(lines: ["fresh"], byAgent: true))
    }

    func testTheWandAnswersOnlyTheConflictsThatNeedNoChoice() {
        let file = GitConflictFile(
            answer: answer(base: "s\nx\nm\ny\ne\n", ours: "s\nx  1\nm\nours\ne\n", theirs: "s\nx 1\nm\ntheirs\ne\n"))
        XCTAssertEqual(file.conflictIndexes.count, 2)
        let wandable = GitConflictDraft().wandable(in: file)
        XCTAssertEqual(wandable.map(\.index), [file.conflictIndexes[0]])
        XCTAssertEqual(wandable.first?.lines, ["x  1"])
    }

    func testWorkIsCarriedOverWhileGitHoldsTheSameVersions() {
        let before = GitConflictFile(answer: answer(hash: "h1"))
        let after = GitConflictFile(answer: answer(hash: "h2"))
        var draft = GitConflictDraft()
        draft.answers[0] = GitBlockAnswer(lines: ["edited"])
        draft.answers[1] = GitBlockAnswer(lines: ["theirs"])
        XCTAssertEqual(draft.carried(from: before, to: after), draft)
        XCTAssertEqual(before.reread(hash: "h2").hash, "h2")
    }

    func testOnlyAnsweredConflictsWhoseStretchStayedComeAlong() {
        let before = GitConflictFile(answer: answer(base: "a\nb\nc\nd\ne\n", ours: "a\nX\nc\nY\ne\n", theirs: "a\nP\nc\nQ\ne\n"))
        let after = GitConflictFile(
            answer: answer(base: "new\na\nb\nc\nd\ne\n", ours: "new\na\nX\nc\nY2\ne\n", theirs: "new\na\nP\nc\nQ\ne\n"))
        var draft = GitConflictDraft()
        draft.answers[before.conflictIndexes[0]] = GitBlockAnswer(lines: ["kept"])
        draft.answers[before.conflictIndexes[1]] = GitBlockAnswer(lines: ["dropped"])
        let carried = draft.carried(from: before, to: after)
        XCTAssertEqual(carried.answers.count, 1)
        XCTAssertEqual(carried.answers[after.conflictIndexes[0]], GitBlockAnswer(lines: ["kept"]))
    }

    func testAStretchTypedByHandIsItsLines() {
        XCTAssertEqual(GitConflictModel.editedLines(""), [])
        XCTAssertEqual(GitConflictModel.editedLines("a\n\nb"), ["a", "", "b"])
    }

    func testAnOlderMachineIsAskedToUpdate() {
        let error = MachineClientError.server(code: "unknown-request", message: "Unknown request git.conflicts")
        XCTAssertEqual(
            gitMessage(error, action: "resolve conflicts on the phone"),
            "Update Ruimte on this machine to resolve conflicts on the phone.")
        XCTAssertEqual(gitMessage(MachineClientError.server(code: "git-failed", message: "No."), action: "x"), "No.")
    }

    @MainActor func testAResolutionIsWrittenOverTheDigestItWasReadAt() async {
        let machine = ConflictMachine()
        let session = GitConflictSession(cwd: "/repo")
        await session.load(client: machine)
        XCTAssertEqual(session.operation, "merge")
        XCTAssertEqual(session.entries.map(\.path), ["a.ts"])
        await session.open(client: machine, path: "a.ts")
        session.answer("a.ts", block: 1, lines: ["theirs"])
        XCTAssertEqual(session.ready, ["a.ts"])
        let saved = await session.save(client: machine, paths: ["a.ts"])
        XCTAssertTrue(saved)
        let resolve = machine.sent.first { $0.type == "git.resolve" }?.payload
        XCTAssertEqual(resolve?["hash"], .string("h1"))
        XCTAssertEqual(resolve?["content"], .string("a\ntheirs\nc\n"))
        XCTAssertNil(resolve?["take"])
    }

    @MainActor func testAFileThatMovedRefusesAndIsReadAgainKeepingTheWork() async {
        let machine = ConflictMachine()
        machine.refuseResolve = true
        let session = GitConflictSession(cwd: "/repo")
        await session.load(client: machine)
        await session.open(client: machine, path: "a.ts")
        session.answer("a.ts", block: 1, lines: ["mine"])
        machine.hash = "h2"
        let saved = await session.save(client: machine, paths: ["a.ts"])
        XCTAssertFalse(saved)
        XCTAssertEqual(session.problem, "a.ts changed on disk while it was being resolved.")
        XCTAssertEqual(session.files["a.ts"]?.hash, "h2")
        XCTAssertEqual(session.draft("a.ts").answers[1], GitBlockAnswer(lines: ["mine"]))
    }

    @MainActor func testAnAgentsAnswerLandsAsAProposalAndIsNotWritten() async {
        let machine = ConflictMachine()
        let session = GitConflictSession(cwd: "/repo")
        await session.load(client: machine)
        await session.ask(client: machine, paths: ["a.ts"])
        XCTAssertEqual(session.draft("a.ts").answers[1], GitBlockAnswer(lines: ["merged"], byAgent: true))
        XCTAssertFalse(machine.sent.contains { $0.type == "git.resolve" })
        XCTAssertNil(session.agentRun)
    }

    @MainActor func testFinishingNamesTheOperationAndReadsTheCheckoutAgain() async {
        let machine = ConflictMachine()
        machine.files = []
        let session = GitConflictSession(cwd: "/repo")
        await session.load(client: machine)
        let done = await session.finish(client: machine, action: "continue")
        XCTAssertTrue(done)
        XCTAssertEqual(session.note, "The merge is finished.")
        XCTAssertEqual(machine.sent.first { $0.type == "git.operation" }?.payload["action"], .string("continue"))
    }

    @MainActor func testAMachineWithoutConflictRequestsSaysItNeedsAnUpdate() async {
        let machine = ConflictMachine()
        machine.unknown = true
        let session = GitConflictSession(cwd: "/repo")
        await session.load(client: machine)
        XCTAssertTrue(session.unsupported)
        XCTAssertTrue(session.loaded)
    }
}

@MainActor private final class ConflictMachine: MachineRequesting {
    var sent: [(type: String, payload: JSONValue)] = []
    var files = ["a.ts"]
    var hash = "h1"
    var refuseResolve = false
    var unknown = false

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        if unknown { throw MachineClientError.server(code: "unknown-request", message: "Unknown request \(type)") }
        switch type {
        case "git.conflicts":
            return .object([
                "operation": files.isEmpty ? .null : .string("merge"), "ours": .string("main"), "theirs": .string("lexer"),
                "files": .array(files.map { .object(["path": .string($0), "kind": .string("text")]) }),
            ])
        case "git.conflict":
            return .object([
                "path": .string("a.ts"), "kind": .string("text"), "base": .string("a\nb\nc\n"),
                "ours": .string("a\nours\nc\n"), "theirs": .string("a\ntheirs\nc\n"), "hash": .string(hash),
            ])
        case "git.resolve":
            if refuseResolve {
                throw MachineClientError.server(code: "git-failed", message: "a.ts changed on disk while it was being resolved.")
            }
            files = []
            return .object(["remaining": .number(0)])
        case "git.resolveAi":
            let block = MergeBlock(kind: .conflict, base: ["b"], ours: ["ours"], theirs: ["theirs"])
            return .object([
                "blocks": .array([
                    .object([
                        "index": .number(1), "fingerprint": .string(ThreeWayMerge.fingerprint(block)),
                        "lines": .array([.string("merged")]),
                    ])
                ])
            ])
        case "git.operation":
            return .object(["actionId": payload["actionId"] ?? .null, "summary": .string("Finished the merge."), "output": .string("")])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
