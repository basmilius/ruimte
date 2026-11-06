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
