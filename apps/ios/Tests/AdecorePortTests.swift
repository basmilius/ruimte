import RuimtePulsar
import XCTest

@testable import Ruimte

/// Holds the Swift copies of ADE CORE logic to `Fixtures/ports-*.json`, which `packages/contracts/scripts/generate-port-*.ts`
/// write by calling the real TypeScript on every case. A rule that moves there fails `check:swift` until the fixture is
/// written again, and fails here until the copy reads the new answer.
final class AdecorePortTests: XCTestCase {
    private func fixture(_ name: String) throws -> JSONValue {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"), name)
        return try JSONValue.decode(Data(contentsOf: url))
    }

    private func cases(_ file: String, _ group: String) throws -> [JSONValue] {
        try XCTUnwrap(try fixture(file)[group]?.arrayValue, group)
    }

    private func lines(_ value: JSONValue?) -> [String] {
        value?.arrayValue?.compactMap(\.stringValue) ?? []
    }

    // MARK: @adecore/merge

    private func block(_ value: JSONValue) -> MergeBlock {
        MergeBlock(
            kind: MergeBlockKind(rawValue: value["kind"]?.stringValue ?? "") ?? .stable, base: lines(value["base"]),
            ours: lines(value["ours"]), theirs: lines(value["theirs"]))
    }

    private func changes(_ value: JSONValue?) -> [MergeChange] {
        (value?.arrayValue ?? []).map {
            MergeChange(
                baseStart: Int($0.number("baseStart")), baseEnd: Int($0.number("baseEnd")),
                otherStart: Int($0.number("otherStart")), otherEnd: Int($0.number("otherEnd")))
        }
    }

    func testTheDiffSplitsAndPrintsAsTheMergePackageDoes() throws {
        let all = try cases("ports-merge", "triples")
        XCTAssertGreaterThan(all.count, 200)
        for (index, entry) in all.enumerated() {
            let base = lines(entry["base"])
            let ours = lines(entry["ours"])
            let theirs = lines(entry["theirs"])
            let label = "case \(index)"
            XCTAssertEqual(ThreeWayMerge.diffLines(base, ours), changes(entry["ourChanges"]), label)
            XCTAssertEqual(ThreeWayMerge.diffLines(base, theirs), changes(entry["theirChanges"]), label)
            let expected = try XCTUnwrap(entry["blocks"]?.arrayValue)
            let blocks = ThreeWayMerge.splitBlocks(base: base, ours: ours, theirs: theirs)
            XCTAssertEqual(blocks, expected.map(block), label)
            XCTAssertEqual(blocks.map(ThreeWayMerge.fingerprint), expected.compactMap { $0["fingerprint"]?.stringValue }, label)
            XCTAssertEqual(
                blocks.map(ThreeWayMerge.wandLines), expected.map { $0["wand"]?.arrayValue == nil ? nil : lines($0["wand"]) }, label)
            XCTAssertEqual(blocks.flatMap { ThreeWayMerge.autoLines($0) ?? $0.ours }, lines(entry["draft"]), label)
        }
    }

    func testAFileIsReadAndPutBackAsTheMergePackageDoes() throws {
        let all = try cases("ports-merge", "files")
        XCTAssertGreaterThan(all.count, 15)
        for entry in all {
            let ours = try XCTUnwrap(entry["ours"]?.stringValue)
            let base = try XCTUnwrap(entry["base"]?.stringValue)
            let theirs = try XCTUnwrap(entry["theirs"]?.stringValue)
            let label = "\(base.debugDescription) \(ours.debugDescription) \(theirs.debugDescription)"
            XCTAssertEqual(ThreeWayMerge.splitLines(base), lines(entry["baseLines"]), label)
            XCTAssertEqual(ThreeWayMerge.splitLines(ours), lines(entry["oursLines"]), label)
            XCTAssertEqual(ThreeWayMerge.splitLines(theirs), lines(entry["theirsLines"]), label)
            let shapes = try XCTUnwrap(entry["shapes"])
            for (text, key) in [(base, "base"), (ours, "ours"), (theirs, "theirs")] {
                let shape = ThreeWayMerge.shapeOf(text)
                XCTAssertEqual(shape.eol, shapes[key]?["eol"]?.stringValue, label)
                XCTAssertEqual(shape.finalNewline, shapes[key]?["finalNewline"]?.boolValue, label)
            }
            let blocks = ThreeWayMerge.splitBlocks(
                base: ThreeWayMerge.splitLines(base), ours: ThreeWayMerge.splitLines(ours),
                theirs: ThreeWayMerge.splitLines(theirs))
            XCTAssertEqual(blocks.map(\.kind.rawValue), lines(entry["blockKinds"]), label)
            XCTAssertEqual(blocks.map(ThreeWayMerge.fingerprint), lines(entry["blockPrints"]), label)
            let merged = ThreeWayMerge.joinLines(
                blocks.flatMap { ThreeWayMerge.autoLines($0) ?? $0.ours }, shape: ThreeWayMerge.shapeOf(ours))
            XCTAssertEqual(merged, entry["merged"]?.stringValue, label)
        }
        for entry in try cases("ports-merge", "join") {
            let shape = MergeTextShape(
                eol: try XCTUnwrap(entry["eol"]?.stringValue), finalNewline: entry["finalNewline"]?.boolValue == true)
            XCTAssertEqual(ThreeWayMerge.joinLines(lines(entry["lines"]), shape: shape), entry["text"]?.stringValue)
        }
    }
}

// MARK: @adecore/plan

extension AdecorePortTests {
    private func planStates(_ value: JSONValue?) -> [PlanStepState] {
        lines(value).compactMap { PlanStepState(rawValue: $0) }
    }

    private func planStep(state: String?, children: [String] = []) throws -> PlanStep {
        var object: [String: JSONValue] = ["type": .string("step"), "id": .string("p"), "title": .string("Parent")]
        if let state { object["state"] = .string(state) }
        if !children.isEmpty {
            object["steps"] = .array(
                children.enumerated().map {
                    .object([
                        "type": .string("step"), "id": .string("c\($0.offset)"), "title": .string("Child"),
                        "state": .string($0.element),
                    ])
                })
        }
        return PlanStep(try JSONValue.object(object).decoded(as: StoredPlanStep.self))
    }

    func testAParentAddsUpItsChildrenAsThePlanPackageDoes() throws {
        let all = try cases("ports-plan", "derived")
        XCTAssertGreaterThan(all.count, 500)
        for entry in all {
            let children = lines(entry["states"])
            XCTAssertEqual(try planStep(state: nil, children: children).state.rawValue, entry["state"]?.stringValue, "\(children)")
        }
        for entry in try cases("ports-plan", "leafStates") {
            XCTAssertEqual(try planStep(state: entry["state"]?.stringValue).state.rawValue, entry["read"]?.stringValue)
        }
        for entry in try cases("ports-plan", "finished") {
            let state = try XCTUnwrap(PlanStepState(rawValue: try XCTUnwrap(entry["state"]?.stringValue)))
            XCTAssertEqual(state.isFinished, entry["finished"]?.boolValue, state.rawValue)
        }
    }

    func testTheStatesAPersonSeesAreThePlanPackagesOwn() throws {
        let tables = try XCTUnwrap(try cases("ports-plan", "tables").first)
        XCTAssertEqual(PlanStepState.personStates, planStates(tables["person"]))
        XCTAssertEqual(PlanStepState.testOutcomes, planStates(tables["test"]))
        XCTAssertEqual(PlanStepState.allCases.filter(\.asksForNote), planStates(tables["asksForNote"]))
        for state in PlanStepState.allCases {
            XCTAssertEqual(state.marker, tables["markers"]?[state.rawValue]?.stringValue, state.rawValue)
        }
    }

    func testAPlanCountsAndCopiesAsThePlanPackageDoes() throws {
        let all = try cases("ports-plan", "plans")
        XCTAssertGreaterThan(all.count, 30)
        for entry in all {
            let value = try XCTUnwrap(entry["plan"])
            let document = PlanDocument(try value.decoded(as: StoredPlan.self))
            let label = document.id
            XCTAssertEqual(document.markdown, entry["markdown"]?.stringValue, label)
            let progress = try XCTUnwrap(entry["progress"])
            XCTAssertEqual(Double(document.progress.total), progress.number("total"), label)
            XCTAssertEqual(Double(document.progress.finished), progress.number("finished"), label)
            for state in PlanStepState.allCases {
                XCTAssertEqual(Double(document.progress.count(state)), progress.number(state.rawValue), "\(label) \(state)")
            }
            var steps: [PlanStep] = []
            func collect(_ step: PlanStep) {
                steps.append(step)
                step.steps.forEach(collect)
            }
            document.steps.forEach(collect)
            let states = try XCTUnwrap(entry["stepStates"])
            let copies = try XCTUnwrap(entry["stepMarkdown"])
            for step in steps {
                XCTAssertEqual(step.state.rawValue, states[step.id]?.stringValue, "\(label) \(step.id)")
                XCTAssertEqual(
                    PlanCopyText.stepLine(step) { "said \($0.rawValue)" }, copies[step.id]?.stringValue, "\(label) \(step.id)")
            }
            XCTAssertEqual(Set(steps.map(\.id)), Set(states.objectValue?.keys.map { $0 } ?? []), label)
        }
    }
}

// MARK: Chat timeline of @adecore/agents-react

extension AdecorePortTests {
    private static let messageKinds: Set<String> = [
        "user", "assistant", "thinking", "approval", "question", "message", "note", "compaction", "report", "sent",
        "workflow", "work", "work-live",
    ]

    private func rowClass(_ kind: String) -> String {
        if Self.messageKinds.contains(kind) { return "message" }
        switch kind {
        case "work-group": return "tools"
        case "turn-fold": return "turnFold"
        case "turn-start": return "turnStart"
        case "selection-switch": return "selectionSwitch"
        case "changed-files": return "changedFiles"
        case "live-thought": return "liveThought"
        case "working": return "activity"
        default: return kind
        }
    }

    private func entryClass(_ entry: ChatTimelineEntry) -> String {
        switch entry.kind {
        case .message: "message"
        case .tools: "tools"
        case .activity: "activity"
        case .turnFold: "turnFold"
        case .turnStart: "turnStart"
        case .selectionSwitch: "selectionSwitch"
        case .changedFiles: "changedFiles"
        case .subagent: "subagent"
        case .forks: "forks"
        case .visual: "visual"
        case .liveThought: "liveThought"
        case .output: "output"
        }
    }

    @MainActor private func branchShape(_ branch: ChatSubagentBranch) -> String {
        let children = branch.children.map(\.id).joined(separator: ",")
        let nested = branch.nested.map(branchShape).joined(separator: ",")
        return "\(branch.record.id)[\(children)][\(nested)]"
    }

    private func branchShape(_ value: JSONValue) -> String {
        let children = lines(value["children"]).joined(separator: ",")
        let nested = (value["nested"]?.arrayValue ?? []).map(branchShape).joined(separator: ",")
        return "\(value.text("id"))[\(children)][\(nested)]"
    }

    @MainActor func testTheThreadIsDrawnAsRowsTheWayTheDesktopDrawsIt() throws {
        let all = try cases("ports-chat", "timeline")
        XCTAssertGreaterThan(all.count, 150)
        var mismatches: [String] = []
        for entry in all {
            let name = entry.text("name")
            let presentation = ChatPresentation()
            let active = entry["activeTurnId"]?.stringValue
            presentation.replace(
                try XCTUnwrap(entry["items"]?.arrayValue).map(\.chatItem),
                info: active.map { ChatWire.info(["activeTurnId": .string($0)]).chatInfo })
            lines(entry["expandedTurns"]).forEach(presentation.toggleTurn)
            presentation.setForks(Dictionary(uniqueKeysWithValues: lines(entry["forkedTurns"]).map { ($0, ["fork"]) }))
            let expected = try XCTUnwrap(entry["rows"]?.arrayValue)
            let actual = presentation.entries
            let expectedIDs = expected.map { $0.text("id") }
            guard actual.map(\.id) == expectedIDs else {
                mismatches.append("\(name): \(actual.map(\.id)) != \(expectedIDs)")
                continue
            }
            for (row, entry) in zip(expected, actual) {
                let kind = row.text("kind")
                guard rowClass(kind) == entryClass(entry) else {
                    mismatches.append("\(name) \(entry.id): \(entryClass(entry)) != \(rowClass(kind))")
                    continue
                }
                switch kind {
                case "subagent":
                    if let branch = entry.branch, branchShape(branch) != branchShape(row) {
                        mismatches.append("\(name) \(entry.id): \(branchShape(branch)) != \(branchShape(row))")
                    }
                case "changed-files":
                    let tools = entry.items.dropFirst().map(\.id)
                    if tools != lines(row["tools"]) { mismatches.append("\(name) \(entry.id): edits \(tools)") }
                case "turn-fold":
                    guard case .turn(let turn)? = entry.items.first?.item else { continue }
                    let label = ChatPresentation.turnLabel(turn, items: Array(entry.items.map(\.item)))
                    if label != row.text("label") {
                        mismatches.append("\(name) \(entry.id): label \(label) != \(row.text("label"))")
                    }
                case "turn-start":
                    guard case .turn(let turn)? = entry.items.first?.item else { continue }
                    let label = ChatPresentation.agentTurnLabel(turn)
                    if label != row.text("label") {
                        mismatches.append("\(name) \(entry.id): start \(label) != \(row.text("label"))")
                    }
                default: break
                }
            }
        }
        XCTAssertTrue(mismatches.isEmpty, "\(mismatches.count) differ:\n" + mismatches.prefix(40).joined(separator: "\n"))
    }
}

// MARK: Tools, runs of calls and the files a call changes

extension AdecorePortTests {
    private func toolItem(_ entry: JSONValue) throws -> ChatToolItem {
        let fields = ChatWire.item([
            "id": entry["id"] ?? .string("tool"), "kind": .string("tool"), "name": entry["name"] ?? .string("Read"),
            "input": entry["input"] ?? .null, "state": entry["state"] ?? .string("done"),
        ])
        return try XCTUnwrap(fields.chatItem.toolItem)
    }

    func testEachToolHasTheMarkAndTheSentenceTheDesktopGivesIt() throws {
        for entry in try cases("ports-chat", "toolTable") {
            let name = entry.text("name")
            // The desktop draws a generated image as a row of its own and never asks for its mark.
            if name == "ImageGeneration" { continue }
            XCTAssertEqual(ChatToolPresentation.icon(name), entry.text("icon"), name)
            XCTAssertEqual(ChatToolPresentation.changesFiles(name), entry["changesFiles"]?.boolValue, name)
        }
    }

    func testACallIsSummarizedAsTheDesktopSummarizesIt() throws {
        for entry in try cases("ports-chat", "toolSummaries") {
            let name = entry.text("name")
            let input = entry["input"] ?? .null
            let label = "\(name) \(input)"
            XCTAssertEqual(ChatToolPresentation.summary(name: name, input: input), entry.text("summary"), label)
            XCTAssertEqual(ChatToolPresentation.summaryIsPath(name: name, input: input), entry["isPath"]?.boolValue, label)
        }
    }

    func testARunOfCallsReadsAsTheDesktopReadsIt() throws {
        let all = try cases("ports-chat", "sentences")
        XCTAssertGreaterThan(all.count, 500)
        var mismatches: [String] = []
        for entry in all {
            let tools = try XCTUnwrap(entry["tools"]?.arrayValue).map(toolItem)
            let names = tools.map { "\($0.name):\($0.state.rawValue)" }.joined(separator: " ")
            let group = ChatToolPresentation.groupLabel(tools).text
            if group != entry.text("group") { mismatches.append("group \(names): \(group) != \(entry.text("group"))") }
            let turn = ChatToolPresentation.turnSummary(tools).map(\.text)
            if turn != lines(entry["turn"]) { mismatches.append("turn \(names): \(turn) != \(lines(entry["turn"]))") }
        }
        XCTAssertTrue(mismatches.isEmpty, "\(mismatches.count) differ:\n" + mismatches.prefix(40).joined(separator: "\n"))
    }

    func testACallNamesTheFilesItChangesAsTheDesktopReadsThem() throws {
        for entry in try cases("ports-chat", "fileEdits") {
            let name = entry.text("name")
            let input = entry["input"] ?? .null
            let tool = try toolItem(.object(["name": .string(name), "input": input]))
            let changes = ChatFileChanges.fromTool(tool)
            guard let edit = entry["edit"], edit != .null else {
                XCTAssertTrue(changes.isEmpty, "\(name) \(input)")
                continue
            }
            let pieces = try XCTUnwrap(edit["pieces"]?.arrayValue)
            XCTAssertEqual(changes.count, pieces.count, "\(name) \(input)")
            for (change, piece) in zip(changes, pieces) {
                let before = piece.text("before")
                let after = piece.text("after")
                XCTAssertEqual(change.path, edit.text("path"), "\(name) \(input)")
                XCTAssertEqual(change.deleted, before.isEmpty ? 0 : before.components(separatedBy: "\n").count, "\(name) \(input)")
                XCTAssertEqual(change.added, after.isEmpty ? 0 : after.components(separatedBy: "\n").count, "\(name) \(input)")
            }
        }
    }

    func testAShellLineSplitsIntoTheCommandsTheDesktopFinds() throws {
        for entry in try cases("ports-chat", "shells") {
            let source = entry.text("source")
            let expected = try XCTUnwrap(entry["commands"]?.arrayValue)
            let actual = ChatShell.commands(source)
            XCTAssertEqual(actual.count, expected.count, source.debugDescription)
            for (command, want) in zip(actual, expected) {
                XCTAssertEqual(command.words.map(\.text), lines(want["words"]), source.debugDescription)
                XCTAssertEqual(command.program.map { Double($0) }, want["program"]?["index"]?.numberValue, source.debugDescription)
                XCTAssertEqual(command.programName, want["program"]?["name"]?.stringValue, source.debugDescription)
                XCTAssertEqual(command.heredoc, want.number("heredocs") > 0, source.debugDescription)
            }
        }
    }
}

// MARK: Sub-agents and workflows

extension AdecorePortTests {
    private func subagent(_ value: JSONValue) throws -> ChatSubagentItem {
        try XCTUnwrap(value.chatItem.subagentItem)
    }

    func testTheSubagentChipSpeaksAsTheDesktopDoes() throws {
        for entry in try cases("ports-chat", "subagentWords") {
            let words = lines(entry["words"]).compactMap { SubagentStatusWord(rawValue: $0) }
            XCTAssertEqual(ChatSubagents.summaryWord(words).rawValue, entry.text("summary"), "\(words)")
            XCTAssertEqual(Double(ChatSubagents.badgeCount(words)), entry.number("badge"), "\(words)")
        }
        for entry in try cases("ports-chat", "subagentProgress") {
            let states = lines(entry["states"]).compactMap { TaskRowState(rawValue: $0) }
            let progress = ChatSubagents.progress(states)
            XCTAssertEqual(Double(progress.done), entry.number("done"), "\(states)")
            XCTAssertEqual(Double(progress.total), entry.number("total"), "\(states)")
            XCTAssertEqual(Double(progress.waiting), entry.number("waiting"), "\(states)")
            XCTAssertEqual(Double(progress.active), entry.number("active"), "\(states)")
        }
        for entry in try cases("ports-chat", "taskRows") {
            let row = try XCTUnwrap(entry["row"])
            XCTAssertEqual(
                ChatSubagents.taskID(id: row.text("id"), origin: row["origin"]?.stringValue), entry["taskId"]?.stringValue,
                "\(row)")
        }
        for entry in try cases("ports-chat", "subagentStatuses") {
            let task = entry["task"].flatMap { $0 == .null ? nil : $0 }
            let agent = try subagent(try XCTUnwrap(entry["item"]))
            let word = ChatSubagents.statusWord(
                agent, task: task.map { TaskWire.task(status: $0.text("status"), paused: $0["paused"]) })
            XCTAssertEqual(word.rawValue, entry.text("word"), "\(agent.status) \(String(describing: task))")
        }
        for entry in try cases("ports-chat", "titles") {
            XCTAssertEqual(ChatSubagents.title(try subagent(try XCTUnwrap(entry["item"]))), entry.text("title"))
        }
    }

    func testTheFlyoutListsTheSubagentsTheDesktopLists() throws {
        for entry in try cases("ports-chat", "flyouts") {
            let items = try XCTUnwrap(entry["items"]?.arrayValue).map(\.chatItem)
            XCTAssertEqual(ChatSubagents.activity(items).map(\.id), lines(entry["active"]))
        }
    }

    private func phaseShape(_ phases: [WorkflowPhaseView]) -> [String] {
        phases.map { phase in
            "\(phase.id)|\(phase.title ?? "-")|" + phase.agents.map { "\($0.agent.index):\($0.state.rawValue)" }.joined(separator: ",")
        }
    }

    func testAWorkflowIsLaidOutAsTheDesktopLaysItOut() throws {
        let all = try cases("ports-chat", "workflows")
        XCTAssertGreaterThan(all.count, 50)
        var mismatches: [String] = []
        for entry in all {
            let workflow = try XCTUnwrap(entry["workflow"]).decoded(as: ChatToolItemWorkflow.self)
            let running = entry["running"]?.boolValue == true
            let phases = ChatWorkflowLayout.phases(workflow, running: running)
            let expected = try XCTUnwrap(entry["phases"]?.arrayValue)
            let shape = expected.map { phase in
                "\(phase.text("key"))|\(phase["title"]?.stringValue ?? "-")|"
                    + (phase["agents"]?.arrayValue ?? []).map { "\(Int($0.number("index"))):\($0.text("state"))" }.joined(separator: ",")
            }
            guard phaseShape(phases) == shape else {
                mismatches.append("\(phaseShape(phases)) != \(shape)")
                continue
            }
            for (phase, want) in zip(phases, expected) {
                for (view, agent) in zip(phase.agents, want["agents"]?.arrayValue ?? []) {
                    let label = "\(view.agent.index) \(view.state)"
                    if ChatWorkflowLayout.time(view) != agent["time"]?.stringValue { mismatches.append("time \(label)") }
                    let preview = ChatWorkflowLayout.preview(view)
                    if preview.tool != agent["preview"]?["tool"]?.stringValue { mismatches.append("tool \(label)") }
                    if preview.text != agent["preview"]?["text"]?.stringValue { mismatches.append("text \(label)") }
                }
            }
            let counts = ChatWorkflowLayout.counts(phases)
            let want = try XCTUnwrap(entry["counts"])
            let have: [Double] = [counts.total, counts.running, counts.waiting, counts.stopped, counts.done, counts.failed].map(Double.init)
            let wanted = ["total", "running", "waiting", "stopped", "done", "failed"].map { want.number($0) }
            if have != wanted { mismatches.append("counts \(have) != \(wanted)") }
        }
        XCTAssertTrue(mismatches.isEmpty, "\(mismatches.count) differ:\n" + mismatches.prefix(40).joined(separator: "\n"))
        for entry in try cases("ports-chat", "workflowDescriptions") {
            XCTAssertEqual(
                ChatWorkflowLayout.description(entry["input"] ?? .null), entry["description"]?.stringValue,
                "\(entry["input"] ?? .null)")
        }
    }
}
