import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatShellPrepareTests: XCTestCase {
    private let finished = ChatReplySource(itemID: "reply", streaming: false)

    func testTheLineKeepsItsExactTextExceptTheFenceNewlineAndNeverADangerousControl() {
        XCTAssertEqual(ChatShellPrepare.commandLine("  echo \"hello\"  \n"), "  echo \"hello\"  ")
        let refused = [
            "", " \n", "echo one\necho two", "echo ok\r", "echo\tok", "\u{1b}[201~echo nope", "echo\u{202e}abc",
            "echo\u{200b}abc", String(repeating: "a", count: 1001),
        ]
        for code in refused {
            XCTAssertNil(ChatShellPrepare.commandLine(code), code)
        }
    }

    func testALineAShellCouldPassUnfinishedIsRefused() {
        for code in ["# a comment", "cat <<EOF", "make &&", "a ||", "a |", "echo \\"] {
            XCTAssertNil(ChatShellPrepare.commandLine(code), code)
        }
        XCTAssertEqual(ChatShellPrepare.commandLine("echo \\\\"), "echo \\\\")
        XCTAssertEqual(ChatShellPrepare.commandLine("cat <<< word"), "cat <<< word")
    }

    func testOnlyAClosedShellBlockOfOneLineInAFinishedMainReplyOffersTheAction() {
        XCTAssertTrue(ChatShellPrepare.offers(language: "bash", code: "echo ok", closed: true, source: finished))
        XCTAssertFalse(ChatShellPrepare.offers(language: "bash", code: "echo ok", closed: false, source: finished))
        XCTAssertFalse(ChatShellPrepare.offers(language: "bash", code: "one\ntwo", closed: true, source: finished))
        XCTAssertFalse(ChatShellPrepare.offers(language: "python", code: "echo ok", closed: true, source: finished))
        XCTAssertFalse(
            ChatShellPrepare.offers(language: "bash", code: "echo\u{1b}nope", closed: true, source: finished))
        XCTAssertFalse(ChatShellPrepare.offers(language: "bash", code: "echo ok", closed: true, source: nil))
        XCTAssertFalse(
            ChatShellPrepare.offers(
                language: "sh", code: "echo ok", closed: true, source: ChatReplySource(itemID: "reply", streaming: true)
            ))
    }

    func testAFenceStillOpenIsNotClosed() {
        let blocks = MarkdownBlock.parse("```bash\necho ok\n```\n\n```zsh\nls")
        XCTAssertEqual(blocks.map(\.closed), [true, false])
    }

    func testTheTerminalsOfTheProjectAreItsTerminalViewsAndTheTerminalNodesNoOtherMachineRuns() {
        let views: [JSONValue] = [
            .object(["id": .string("term"), "kind": .string("terminal")]),
            .object([
                "id": .string("canvas"), "kind": .string("canvas"),
                "nodes": .array([
                    .object(["id": .string("here"), "kind": .string("terminal")]),
                    .object([
                        "id": .string("there"), "kind": .string("terminal"), "machine": .string("b"),
                    ]),
                    .object(["id": .string("chat"), "kind": .string("chat")]),
                ]),
            ]),
        ]
        XCTAssertEqual(ChatShellPrepare.terminals(ProjectWire.stored(views)), ["term", "here"])
    }

    func testAPreviewReadsTheMachineCommandAndTargets() {
        let preview = ChatPreparePreview(
            .object([
                "machineId": .string("m1"), "machine": .string("Studio"), "command": .string("echo ok"),
                "cwd": .string("/work"),
                "targets": .array([
                    .object([
                        "token": .string("t1"), "sessionId": .string("s1"), "title": .string("Shell"),
                        "cwd": .string("/work"),
                    ])
                ]),
            ]))
        XCTAssertEqual(preview.machine, "Studio")
        XCTAssertEqual(preview.targets, [ChatPrepareTarget(token: "t1", sessionID: "s1", title: "Shell")])
    }
}
