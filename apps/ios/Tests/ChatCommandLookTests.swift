import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatCommandLookTests: XCTestCase {
    func testACallReadsAsThePartItsVerbWorksOnFromTheWordThatSaysWhatItDoes() {
        XCTAssertEqual(
            line(#"ruimte-context computer menu "Ruimte Dev" "File > New View" --wait 5"#),
            Line("Computer Use", #"menu "Ruimte Dev" "File > New View" --wait 5"#))
        XCTAssertEqual(
            line(
                #"ruimte-context node new note --view main --title "Open punten" && ruimte-context link new a b --view main"#
            ),
            Line("Canvas", #"node new note --view main --title "Open punten""#, more: 1))
        XCTAssertEqual(
            line("ruimte-context done --result-file /tmp/result.md"), Line("Task", "done --result-file /tmp/result.md"))
        XCTAssertEqual(
            line(#"ruimte-context alert --text "De build is groen""#),
            Line("Notification", #"--text "De build is groen""#))
        XCTAssertEqual(line("ruimte-context help computer click"), Line("Help", "computer click"))
        XCTAssertEqual(
            line("NO_COLOR=1 ~/.ruimte/bin/ruimte-context launches read api --tail 80"),
            Line("Launches", "read api --tail 80"))
        XCTAssertEqual(
            line(#"sleep 3; ruimte-context computer state "Ruimte Dev" 2>&1 | grep -E x"#),
            Line("Computer Use", #"state "Ruimte Dev""#, others: ["sleep", "grep"]))
    }

    func testAVerbThisAppDoesNotKnowReadsAsRuimteAloneAndNoVerbAsContext() {
        XCTAssertEqual(line("ruimte-context teleport --to mars"), Line("", "teleport --to mars"))
        XCTAssertNil(RuimteCommandLook.match("ruimte-context teleport")?.groupKey)
        XCTAssertEqual(line("ruimte-context"), Line("Context", ""))
    }

    func testALongValueIsCutSoTheOptionsAfterItStay() {
        let prompt = "The tokenizer drops a trailing heredoc marker when the line ends in a comment"
        XCTAssertEqual(
            RuimteCommandLook.match(
                #"ruimte-context agent codex --task "Fix the lexer" --prompt "\#(prompt)" --view Werk"#)?.detail,
            #"codex --task "Fix the lexer" --prompt "\#(prompt.prefix(40))…" --view Werk"#)
        XCTAssertEqual(
            RuimteCommandLook.match("ruimte-context done --result \(String(repeating: "x", count: 50))")?.detail,
            "done --result \(String(repeating: "x", count: 40))…")
        XCTAssertEqual(
            RuimteCommandLook.match(#"ruimte-context task new --title "\#(prompt)""#)?.detail,
            #"new --title "\#(prompt)""#)
    }

    func testOnlyTheProgramItselfIsRuimteNeverAMentionOfIt() {
        XCTAssertNil(RuimteCommandLook.match(#"grep -rn "ruimte-context" apps/server/src/canvas"#))
        XCTAssertNil(RuimteCommandLook.match("which ruimte-context"))
        XCTAssertNil(RuimteCommandLook.match("bun src/main.ts status --port 4211"))
        XCTAssertNil(RuimteCommandLook.run(of: tool("Read", ["file_path": .string("ruimte-context")])))
    }

    func testWhatElseTheLineRanReadsAsTags() {
        let fed = RuimteCommandLook.match("ruimte-context visual new <<'EOF'\n<div></div>\nEOF\nls")
        XCTAssertEqual(fed.map(RuimteCommandLook.tags), ["+ ls, heredoc"])
        XCTAssertEqual(
            RuimteCommandLook.match("ruimte-context node list && ruimte-context link list").map(RuimteCommandLook.tags),
            ["+1"])
        XCTAssertEqual(RuimteCommandLook.match("ruimte-context node list").map(RuimteCommandLook.tags), [])
    }

    func testTheTitleBoldsTheBrand() {
        let title = RuimteCommandLook.title(RuimteCommandLook.match("ruimte-context node list")!)
        XCTAssertEqual(String(title.characters), "Ruimte Canvas")
        let brand = title.range(of: "Ruimte")!
        XCTAssertEqual(title[brand].inlinePresentationIntent, .stronglyEmphasized)
        XCTAssertEqual(
            String(RuimteCommandLook.title(RuimteCommandLook.match("ruimte-context x")!).characters), "Ruimte")
    }

    func testIdsReadAsTheTitlesTheyHaveNow() {
        let views: [JSONValue] = [
            .object([
                "id": .string("main"), "kind": .string("canvas"), "name": .string("Werk"),
                "nodes": .array([
                    .object(["id": .string("chat-ab12"), "kind": .string("chat"), "title": .string("Lexer")]),
                    .object(["id": .string("note-x9"), "kind": .string("note"), "title": .string("")]),
                ]),
            ])
        ]
        let names = RuimteCommandLook.projectNames(views)
        XCTAssertEqual(names["chat-ab12"], ChatCommandName(name: "Lexer", icon: "message-square", view: false))
        XCTAssertEqual(names["main"], ChatCommandName(name: "Werk", icon: "frame", view: true))
        let run = RuimteCommandLook.match("ruimte-context read chat-ab12 --view main note-x9 term-zz main")!
        let lexer = ChatCommandName(name: "Lexer", icon: "message-square", view: false)
        let werk = ChatCommandName(name: "Werk", icon: "frame", view: true)
        XCTAssertEqual(
            RuimteCommandLook.detailParts(run, names: names),
            [
                .text("read "), .name(lexer, word: "chat-ab12"), .text(" --view "), .name(werk, word: "main"),
                .text(" note-x9 term-zz main"),
            ])
        XCTAssertEqual(RuimteCommandLook.detailParts(run, names: [:]), [.text(run.detail)])
    }

    func testARunOfOnePartReadsAsUsingItAndOfSeveralAsUsingRuimte() {
        let clicks = [bash("ruimte-context computer click a"), bash("ruimte-context computer state a")]
        XCTAssertEqual(
            ChatToolPresentation.groupLabel(clicks),
            ChatToolSentence(text: "Used Ruimte Computer Use 2 times", branded: true))
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([bash("ruimte-context computer click a"), bash("ruimte-context node list")]
            ),
            ChatToolSentence(text: "Used Ruimte 2 times", branded: true))
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([bash("ruimte-context computer click a"), bash("ls")]).text,
            "Ran 2 commands")
        let label = ChatToolPresentation.groupLabel(clicks).attributed
        XCTAssertEqual(label[label.range(of: "Ruimte")!].inlinePresentationIntent, .stronglyEmphasized)
    }

    func testAGroupReadsAsTheDesktopWritesIt() {
        let edit = { (path: String) in self.tool("Edit", ["file_path": .string(path)]) }
        XCTAssertEqual(ChatToolPresentation.groupLabel([edit("a"), edit("a"), edit("b")]).text, "Edited 2 files")
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([tool("Write", [:]), tool("Write", [:])]).text, "Wrote 2 files")
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([edit("a"), tool("Write", ["file_path": .string("b")])]).text,
            "Edited 2 files")
        XCTAssertEqual(ChatToolPresentation.groupLabel([tool("Skill", [:]), tool("Skill", [:])]).text, "Used 2 skills")
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([tool("TodoWrite", [:]), tool("TodoWrite", [:])]).text, "Updated 2 plans")
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([tool("mcp__x", [:]), tool("mcp__x", [:])]).text, "mcp__x 2 calls")
        XCTAssertEqual(ChatToolPresentation.groupLabel([tool("Read", [:]), tool("Grep", [:])]).text, "2 tool calls")
    }

    func testAFoldedTurnCountsRuimteCallsByThePartTheyWorkOn() {
        let summary = ChatToolPresentation.turnSummary([
            tool("Read", [:]), bash("ruimte-context node list"), bash("ruimte-context link new a b"),
            bash("ruimte-context teleport"), bash("ls"), tool("Unknown", [:]),
        ])
        XCTAssertEqual(
            summary,
            [
                ChatToolSentence(text: "Read 1 file"),
                ChatToolSentence(text: "Used Ruimte Canvas 2 times", branded: true),
                ChatToolSentence(text: "Ran 2 commands"), ChatToolSentence(text: "1 other tool call"),
            ])
        XCTAssertEqual(
            String(ChatToolPresentation.turnLine(summary).characters),
            "· Read 1 file · Used Ruimte Canvas 2 times · Ran 2 commands · 1 other tool call")
    }

    @MainActor func testEveryToolHasTheMarkTheDesktopGivesIt() {
        let icons = [
            "Read": "eye", "NotebookRead": "eye", "Edit": "square-pen", "MultiEdit": "square-pen",
            "Write": "square-pen", "NotebookEdit": "square-pen", "ApplyPatch": "square-pen", "Bash": "terminal",
            "Grep": "search", "Glob": "folder-search", "WebFetch": "globe", "WebSearch": "globe", "Task": "bot",
            "Agent": "bot", "Skill": "zap", "TodoWrite": "list-todo", "Workflow": "workflow",
            "ImageGeneration": "image", "mcp__github__issue": "hammer", "Unknown": "wrench",
        ]
        for (name, icon) in icons {
            XCTAssertEqual(ChatToolPresentation.icon(name), icon, name)
            XCTAssertNotNil(LucideIcon.icon(named: icon), icon)
        }
        XCTAssertEqual(ChatToolPresentation.mark(bash("ruimte-context node list")), .ruimte)
        XCTAssertEqual(ChatToolPresentation.mark(bash("ls")), .lucide("terminal"))
    }

    func testTheShellSplitsALineAsAShellWould() {
        let commands = ChatShell.commands("FOO=1 sudo -E env bun test 2>/dev/null | tee 'out file' && echo \"a\\\"b\"")
        XCTAssertEqual(commands.map(\.programName), ["bun", "tee", "echo"])
        XCTAssertEqual(commands[1].words.map(\.text), ["tee", "out file"])
        XCTAssertEqual(commands[2].words.last?.text, "a\"b")
        XCTAssertEqual(ChatShell.commands("uv run pytest # ruimte-context").map(\.programName), ["pytest"])
        XCTAssertEqual(ChatShell.commands("echo $(ruimte-context node list)").map(\.programName), ["echo"])
    }

    private func notify(_ command: String, output: String?, state: String = "done") -> ChatAgentSent? {
        RuimteCommandLook.sent(
            of: ChatWire.item([
                "id": .string("call"), "kind": .string("tool"), "name": .string("Bash"),
                "input": .object(["command": .string(command)]), "state": .string(state),
                "output": output.map(JSONValue.string) ?? .null,
            ]).chatTool)
    }

    func testANotifyReadsAsTheMessageItSentAndHowItWent() {
        let call = #"ruimte-context notify chat-b --text "first\nsecond""#
        XCTAssertEqual(
            notify(call, output: "notified\tchat-b\tnow\tdetail\tLead"),
            ChatAgentSent(to: "chat-b", title: "Lead", hint: nil, text: "first\nsecond", state: .delivered, reason: nil))
        XCTAssertEqual(notify(call, output: "notified\tchat-b\twaiting\tdetail")?.state, .waiting)
        XCTAssertEqual(notify(call, output: nil, state: "running")?.state, .sending)
        XCTAssertEqual(notify(call, output: "Exit code 3\nrefused\tnot-an-agent\tmessage", state: "error")?.state, .failed)
        XCTAssertNotNil(notify(call, output: "Exit code 3\nrefused\tnot-an-agent\tmessage", state: "error")?.reason)
        XCTAssertNil(notify(call, output: "refused\tnew-code\tmessage", state: "error")?.reason)
        XCTAssertNil(notify(call, output: ""))
    }

    func testANotifyFedAHeredocSaysItsLinesUnlessTheShellFillsThemIn() {
        let answer = "notified\tchat-b\tnow\tdetail"
        XCTAssertEqual(notify("ruimte-context notify chat-b --text - <<'EOF'\ncosts $5\nEOF", output: answer)?.text, "costs $5\n")
        XCTAssertNil(notify("ruimte-context notify chat-b --text - <<EOF\ncosts $PRICE\nEOF", output: answer))
    }

    func testANotifyTheClientCannotReadStaysAToolLine() {
        let answer = "notified\tchat-b\tnow\tdetail"
        XCTAssertNil(notify(#"cd x && ruimte-context notify chat-b --text "hi""#, output: answer))
        XCTAssertNil(notify(#"ruimte-context notify chat-b --text "$MESSAGE""#, output: answer))
        XCTAssertNil(notify(#"ruimte-context notify chat-b --text "a"; ruimte-context notify chat-c --text "b""#, output: answer))
        XCTAssertNil(notify("echo hi | ruimte-context notify chat-b --text -", output: answer))
        XCTAssertNil(notify(#"ruimte-context answer chat-b --text "hi""#, output: answer))
        XCTAssertEqual(notify("ruimte-context notify chat-b --text 'costs $5'", output: answer)?.text, "costs $5")
    }

    func testANotifyToAnotherProjectSaysSoUntilItKnowsTheName() {
        let call = #"ruimte-context notify chat-b --text "hi" --project site"#
        let sent = notify(call, output: "notified\tchat-b\tnow\tdetail")
        XCTAssertEqual(sent?.hint, "site")
        XCTAssertEqual(notify(call, output: "notified\tchat-b\tnow\tdetail\tLead")?.title, "Lead")
    }

    private struct Line: Equatable {
        let label: String
        let detail: String
        var others: [String] = []
        var more = 0

        init(_ label: String, _ detail: String, others: [String] = [], more: Int = 0) {
            self.label = label
            self.detail = detail
            self.others = others
            self.more = more
        }
    }

    private func line(_ command: String) -> Line? {
        RuimteCommandLook.match(command).map { Line($0.label, $0.detail, others: $0.others, more: $0.more) }
    }

    func testAToolOfTheMachineReadsAsThePartItWorksOnInEveryShapeACliGivesIt() {
        let shapes = [
            tool("mcp__ruimte__context_list", [:]),
            tool("ruimte/context_list", [:]),
            tool(
                "Tool",
                [
                    "description": .string("ruimte__context_list"), "variant": .string("UseTool"),
                    "tool_name": .string("ruimte__context_list"), "tool_input": .object([:]),
                ]),
            tool("Tool", ["description": .string("ruimte_context_list"), "arguments": .object([:])]),
            tool("Read", ["description": .string("ruimte-context_list")]),
        ]
        for shape in shapes {
            XCTAssertEqual(
                RuimteCommandLook.run(of: shape).map { Line($0.label, $0.detail) }, Line("Context", "context list"))
        }
        XCTAssertNil(RuimteCommandLook.run(of: tool("mcp__ruimte__teleport", [:])))
        XCTAssertNil(RuimteCommandLook.run(of: tool("mcp__other__node_new", [:])))
        XCTAssertNil(
            RuimteCommandLook.run(
                of: tool("Bash", ["command": .string("ls"), "description": .string("ruimte-node_list")])))
        XCTAssertEqual(ChatToolPresentation.mark(tool("mcp__ruimte__node_list", [:])), .ruimte)
    }

    func testANameThatSaysTheServerWinsOverAnyTitleTheLongestServerFirst() {
        let titled = tool("mcp__ruimte__node_list", ["description": .string("github__issue_list")])
        XCTAssertEqual(ChatMcpCall.of(titled, servers: ["github", "ruimte"])?.server, "ruimte")
        let foreign = tool("mcp__other__node_list", ["description": .string("ruimte__node_list")])
        XCTAssertNil(ChatMcpCall.of(foreign, servers: ["ruimte"]))
        XCTAssertNil(ChatMcpCall.of(tool("other/node_list", ["description": .string("ruimte__node_list")]), servers: ["ruimte"]))
        let longer = ChatMcpCall.of(tool("mcp__ruimte__dev__node_list", [:]), servers: ["ruimte", "ruimte__dev"])
        XCTAssertEqual(longer.map { [$0.server, $0.tool] }, ["ruimte__dev", "node_list"])
        XCTAssertNil(ChatMcpCall.of(tool("Edit", ["description": .string("ruimte__node_list")]), servers: ["ruimte"]))
        XCTAssertNil(
            ChatMcpCall.of(
                tool("Read", ["description": .string("ruimte__node_list"), "file_path": .string("/a")]), servers: ["ruimte"]))
    }

    func testGrokAnswersComeOutOfTheirEnvelopeWhateverTheOrderOfItsKeys() {
        let item = ChatWire.item([
            "id": .string("call"), "kind": .string("tool"), "name": .string("mcp__ruimte__node_list"),
            "input": .object([:]), "state": .string("done"),
            "output": .string(#"  {"output":{"OkayOutput":"node\tn1"},"server_name":"ruimte","type":"MCP"}"#),
        ]).chatTool
        XCTAssertEqual(ChatMcpCall.of(item, servers: ["ruimte"])?.output, "node\tn1")
        let other = ChatWire.item([
            "id": .string("call"), "kind": .string("tool"), "name": .string("mcp__ruimte__node_list"),
            "input": .object([:]), "state": .string("done"),
            "output": .string(#"{"type":"Other","output":{"OkayOutput":"x"}}"#),
        ]).chatTool
        XCTAssertEqual(ChatMcpCall.of(other, servers: ["ruimte"])?.output, #"{"type":"Other","output":{"OkayOutput":"x"}}"#)
    }

    func testAToolCallDrawsItsFieldsWithIdsAsTheirTitles() {
        let call = tool(
            "mcp__ruimte__node_new",
            [
                "title": .string("Open punten"), "kind": .string("note"), "view": .string("main"),
                "text": .string(String(repeating: "x", count: 50)),
            ])
        let run = RuimteCommandLook.run(of: call)!
        XCTAssertEqual(run.label, "Canvas")
        XCTAssertEqual(
            run.detail, #"node new kind=note text=\#(String(repeating: "x", count: 40))… title="Open punten" view=main"#
        )
        let werk = ChatCommandName(name: "Werk", icon: "frame", view: true)
        XCTAssertEqual(
            RuimteCommandLook.detailParts(run, names: ["main": werk]).last, .name(werk, word: "main"))
        let device = RuimteCommandLook.run(
            of: tool("ruimte/device_shot", ["device": .string("iphone"), "wait": .number(3)]))
        XCTAssertEqual(device.map { Line($0.label, $0.detail) }, Line("Device", "shot device=iphone wait=3"))
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([tool("mcp__ruimte__node_new", [:]), tool("mcp__ruimte__link_new", [:])]),
            ChatToolSentence(text: "Used Ruimte Canvas 2 times", branded: true))
        // The tool and the command are two looks, so a run of both is no one look's.
        XCTAssertEqual(
            ChatToolPresentation.groupLabel([tool("mcp__ruimte__node_new", [:]), bash("ruimte-context link new a b")]),
            ChatToolSentence(text: "2 tool calls"))
    }

    private func notifyTool(_ input: [String: JSONValue], output: String?, state: String = "done") -> ChatAgentSent? {
        RuimteCommandLook.sent(
            of: ChatWire.item([
                "id": .string("call"), "kind": .string("tool"), "name": .string("mcp__ruimte__notify"),
                "input": .object(input), "state": .string(state), "output": output.map(JSONValue.string) ?? .null,
            ]).chatTool)
    }

    func testANotifyToolReadsAsTheMessageItSentWithItsTextAsItIs() {
        let input: [String: JSONValue] = ["id": .string("chat-b"), "text": .string(#"a\nb"#)]
        XCTAssertEqual(
            notifyTool(input, output: "notified\tchat-b\tnow\tdetail\tLead"),
            ChatAgentSent(to: "chat-b", title: "Lead", hint: nil, text: #"a\nb"#, state: .delivered, reason: nil))
        XCTAssertEqual(notifyTool(input, output: nil, state: "running")?.state, .sending)
        let refused = notifyTool(input, output: "refused self-notify: you cannot notify yourself", state: "error")
        XCTAssertEqual(refused?.state, .failed)
        XCTAssertNotNil(refused?.reason)
        XCTAssertEqual(
            notifyTool(input.merging(["project": .string("site")]) { $1 }, output: "notified\tchat-b\tnow\td")?.hint,
            "site")
        XCTAssertNil(notifyTool(["text": .string("hi")], output: "notified\tchat-b\tnow\td"))
        let grok = ChatWire.item([
            "id": .string("call"), "kind": .string("tool"), "name": .string("Tool"),
            "input": .object([
                "description": .string("ruimte__notify"), "tool_name": .string("ruimte__notify"),
                "tool_input": .object(input),
            ]),
            "state": .string("done"),
            "output": .string(
                #"{"type":"MCP","tool_name":"notify","server_name":"ruimte","output":{"OkayOutput":"notified\tchat-b\twaiting\td"}}"#
            ),
        ]).chatTool
        XCTAssertEqual(RuimteCommandLook.sent(of: grok)?.state, .waiting)
    }

    private func bash(_ command: String) -> ChatToolItem {
        tool("Bash", ["command": .string(command)])
    }

    private func tool(_ name: String, _ input: [String: JSONValue]) -> ChatToolItem {
        ChatWire.item([
            "id": .string(UUID().uuidString), "kind": .string("tool"), "name": .string(name),
            "input": .object(input),
        ]).chatTool
    }
}
