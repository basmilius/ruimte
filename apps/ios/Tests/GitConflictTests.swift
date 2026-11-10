import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class GitConflictTests: XCTestCase {
    private func answer(
        path: String = "a.ts", base: String? = "a\nb\nc\n", ours: String? = "a\nours\nc\n",
        theirs: String? = "a\ntheirs\nc\n", kind: GitConflictKind = .text, hash: String = "h1"
    ) -> GitConflictDetail {
        GitConflictDetail(path: path, kind: kind, base: base, ours: ours, theirs: theirs, hash: hash)
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
        let file = GitConflictFile(
            answer: answer(base: "a\r\nb\r\nc", ours: "a\r\nours\r\nc", theirs: "a\r\ntheirs\r\nc"))
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
        XCTAssertTrue(GitConflictFile(answer: answer(ours: nil, kind: .deletedByUs)).whole)
        XCTAssertTrue(GitConflictFile(answer: answer(kind: .binary)).whole)
        XCTAssertTrue(GitConflictFile(answer: answer(theirs: nil)).whole)
    }

    func testOnlyProposalsForTheSameStretchAreUsed() {
        let file = GitConflictFile(answer: answer())
        let print = ThreeWayMerge.fingerprint(file.blocks[1])
        let usable = GitConflictModel.usable(
            file,
            answers: [
                GitResolveAiBlock(index: 1, fingerprint: print, lines: ["merged"]),
                GitResolveAiBlock(index: 1, fingerprint: "00000000", lines: ["stale"]),
                GitResolveAiBlock(index: 0, fingerprint: ThreeWayMerge.fingerprint(file.blocks[0]), lines: []),
                GitResolveAiBlock(index: 9, fingerprint: print, lines: []),
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
        XCTAssertTrue(GitConflictDraft().wandable(in: file).isEmpty)

        let contained = GitConflictFile(
            answer: answer(
                base: "s\nx\nm\ny\ne\n", ours: "s\none\nm\nours\ne\n", theirs: "s\none\ntwo\nm\ntheirs\ne\n"))
        XCTAssertEqual(contained.conflictIndexes.count, 2)
        var draft = GitConflictDraft()
        let wandable = draft.wandable(in: contained)
        XCTAssertEqual(wandable.map(\.index), [contained.conflictIndexes[0]])
        XCTAssertEqual(wandable.first?.lines, ["one", "two"])
        draft.answers[contained.conflictIndexes[0]] = GitBlockAnswer(lines: ["mine"])
        XCTAssertEqual(draft.open(in: contained), [contained.conflictIndexes[1]])
        XCTAssertTrue(draft.wandable(in: contained).isEmpty)
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
        let before = GitConflictFile(
            answer: answer(base: "a\nb\nc\nd\ne\n", ours: "a\nX\nc\nY\ne\n", theirs: "a\nP\nc\nQ\ne\n"))
        let after = GitConflictFile(
            answer: answer(base: "new\na\nb\nc\nd\ne\n", ours: "new\na\nX\nc\nY2\ne\n", theirs: "new\na\nP\nc\nQ\ne\n"))
        var draft = GitConflictDraft()
        draft.answers[before.conflictIndexes[0]] = GitBlockAnswer(lines: ["kept"])
        draft.answers[before.conflictIndexes[1]] = GitBlockAnswer(lines: ["dropped"])
        let carried = draft.carried(from: before, to: after)
        XCTAssertEqual(carried.answers.count, 1)
        XCTAssertEqual(carried.answers[after.conflictIndexes[0]], GitBlockAnswer(lines: ["kept"]))
    }

    private var twoConflicts: GitConflictFile {
        GitConflictFile(answer: answer(base: "a\nb\nc\nd\ne\n", ours: "a\nX\nc\nY\ne\n", theirs: "a\nP\nc\nQ\ne\n"))
    }

    func testEditingTheWholeFileOutsideAConflictLeavesItOpen() {
        let file = twoConflicts
        let draft = GitConflictDraft().editedWhole(["a", "X", "c2", "Y", "e"], in: file)
        XCTAssertEqual(draft.open(in: file), file.conflictIndexes)
        XCTAssertEqual(draft.content(of: file), "a\nX\nc2\nY\ne\n")
    }

    func testEditingInsideAConflictAnswersIt() {
        let file = twoConflicts
        let draft = GitConflictDraft().editedWhole(["a", "X and P", "c", "Y", "e"], in: file)
        XCTAssertEqual(draft.answers[file.conflictIndexes[0]], GitBlockAnswer(lines: ["X and P"]))
        XCTAssertEqual(draft.open(in: file), [file.conflictIndexes[1]])
        XCTAssertEqual(draft.content(of: file), "a\nX and P\nc\nY\ne\n")
    }

    func testALineTypedOnTheEdgeOfAConflictGoesToTheConflict() {
        let file = twoConflicts
        let draft = GitConflictDraft().editedWhole(["a", "X", "c", "new", "Y", "e"], in: file)
        XCTAssertEqual(draft.answers[file.conflictIndexes[1]], GitBlockAnswer(lines: ["new", "Y"]))
        XCTAssertEqual(draft.lines(in: file), ["a", "X", "c", "new", "Y", "e"])
    }

    func testAnEditAcrossStretchesKeepsTheTextAsTyped() {
        let file = twoConflicts
        let edited = ["a", "joined", "e", "tail"]
        let draft = GitConflictDraft().editedWhole(edited, in: file)
        XCTAssertEqual(draft.lines(in: file), edited)
        XCTAssertTrue(draft.open(in: file).count < 2)
    }

    func testAProposalNobodyTouchedStaysAProposal() {
        let file = twoConflicts
        var draft = GitConflictDraft()
        draft.answers[file.conflictIndexes[0]] = GitBlockAnswer(lines: ["P"], byAgent: true)
        let next = draft.editedWhole(["a", "P", "c", "Y!", "e"], in: file)
        XCTAssertEqual(next.answers[file.conflictIndexes[0]], GitBlockAnswer(lines: ["P"], byAgent: true))
        XCTAssertEqual(next.answers[file.conflictIndexes[1]], GitBlockAnswer(lines: ["Y!"]))
        XCTAssertTrue(next.open(in: file).isEmpty)
    }

    func testAStretchTypedByHandIsItsLines() {
        XCTAssertEqual(GitConflictModel.editedLines(""), [])
        XCTAssertEqual(GitConflictModel.editedLines("a\n\nb"), ["a", "", "b"])
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
        let resolve = machine.sent.first { $0.type == .gitResolve }?.payload
        XCTAssertEqual(resolve?["hash"], .string("h1"))
        XCTAssertEqual(resolve?["content"], .string("a\ntheirs\nc\n"))
        XCTAssertNil(resolve?["take"])
    }

    @MainActor func testAWholeFileWrittenByHandGoesOutOverTheDigestItWasReadAt() async {
        let machine = ConflictMachine()
        let session = GitConflictSession(cwd: "/repo")
        await session.load(client: machine)
        await session.open(client: machine, path: "a.ts")
        session.editWhole("a.ts", text: "a\nboth\nc")
        XCTAssertEqual(session.ready, ["a.ts"])
        let saved = await session.save(client: machine, paths: ["a.ts"])
        XCTAssertTrue(saved)
        let resolve = machine.sent.first { $0.type == .gitResolve }?.payload
        XCTAssertEqual(resolve?["content"], .string("a\nboth\nc\n"))
        XCTAssertEqual(resolve?["hash"], .string("h1"))
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
        XCTAssertFalse(machine.sent.contains { $0.type == .gitResolve })
        XCTAssertNil(session.agentRun)
    }

    @MainActor func testFinishingNamesTheOperationAndReadsTheCheckoutAgain() async {
        let machine = ConflictMachine()
        machine.files = []
        let session = GitConflictSession(cwd: "/repo")
        await session.load(client: machine)
        machine.files = ["next.ts"]
        let before = machine.sent.count
        let done = await session.finish(client: machine, action: "continue")
        XCTAssertTrue(done)
        XCTAssertEqual(session.note, "The merge is finished.")
        XCTAssertEqual(machine.sent.first { $0.type == .gitOperation }?.payload["action"], .string("continue"))
        XCTAssertEqual(Array(machine.sent.dropFirst(before)).map(\.type), [.gitOperation, .gitConflicts])
        XCTAssertEqual(session.operation, "merge")
        XCTAssertEqual(session.entries.map(\.path), ["next.ts"])
    }
}

@MainActor private final class ConflictMachine: MachineRequesting {
    var sent: [(type: WireRequest, payload: JSONValue)] = []
    var files = ["a.ts"]
    var hash = "h1"
    var refuseResolve = false

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        sent.append((type, payload))
        switch type {
        case .gitConflicts:
            return .object([
                "operation": files.isEmpty ? .null : .string("merge"), "ours": .string("main"),
                "theirs": .string("lexer"),
                "files": .array(files.map { .object(["path": .string($0), "kind": .string("text")]) }),
            ])
        case .gitConflict:
            return .object([
                "path": .string("a.ts"), "kind": .string("text"), "base": .string("a\nb\nc\n"),
                "ours": .string("a\nours\nc\n"), "theirs": .string("a\ntheirs\nc\n"), "hash": .string(hash),
            ])
        case .gitResolve:
            if refuseResolve {
                throw MachineClientError.server(
                    code: "git-failed", message: "a.ts changed on disk while it was being resolved.")
            }
            files = []
            return .object(["remaining": .number(0)])
        case .gitResolveAi:
            let block = MergeBlock(kind: .conflict, base: ["b"], ours: ["ours"], theirs: ["theirs"])
            return .object([
                "blocks": .array([
                    .object([
                        "index": .number(1), "fingerprint": .string(ThreeWayMerge.fingerprint(block)),
                        "lines": .array([.string("merged")]),
                    ])
                ])
            ])
        case .gitOperation:
            return .object([
                "actionId": payload["actionId"] ?? .null, "summary": .string("Finished the merge."),
                "output": .string(""),
            ])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
