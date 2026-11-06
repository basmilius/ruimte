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
