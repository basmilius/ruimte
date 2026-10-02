import XCTest

@testable import Ruimte

/// The expected values come from `packages/merge` run under Bun: the daemon answers `git.resolveAi` by block
/// index and fingerprint, so the port has to split and print exactly as the TypeScript does.
final class GitMergeTests: XCTestCase {
    private func summary(_ blocks: [MergeBlock]) -> [String] {
        blocks.map { "\($0.kind.rawValue) \($0.base.count) \($0.ours.count) \($0.theirs.count) \(ThreeWayMerge.fingerprint($0))" }
    }

    private func rebuild(_ base: [String], _ other: [String]) -> [String] {
        var out: [String] = []
        var at = 0
        for change in ThreeWayMerge.diffLines(base, other) {
            out += base[at..<change.baseStart]
            out += other[change.otherStart..<change.otherEnd]
            at = change.baseEnd
        }
        return out + base[at...]
    }

    func testAnUnchangedFileHasNoChanges() {
        XCTAssertEqual(ThreeWayMerge.diffLines(["a", "b"], ["a", "b"]), [])
    }

    func testAChangeInTheMiddleCoversOnlyTheMiddle() {
        XCTAssertEqual(
            ThreeWayMerge.diffLines(["a", "b", "c"], ["a", "x", "c"]),
            [MergeChange(baseStart: 1, baseEnd: 2, otherStart: 1, otherEnd: 2)])
        XCTAssertEqual(
            ThreeWayMerge.diffLines(["a", "c"], ["a", "b", "c"]),
            [MergeChange(baseStart: 1, baseEnd: 1, otherStart: 1, otherEnd: 2)])
    }

    func testTheDiffBreaksTiesAsTheTypeScriptDoes() {
        let changes = ThreeWayMerge.diffLines(["a", "b", "c", "a", "b", "b", "a"], ["c", "b", "a", "b", "a", "c"])
        XCTAssertEqual(
            changes.map { [$0.baseStart, $0.baseEnd, $0.otherStart, $0.otherEnd] },
            [[0, 2, 0, 0], [3, 3, 1, 2], [5, 6, 4, 4], [7, 7, 5, 6]])
    }

    /// A distance past 64 walks the saved states again on the way back.
    func testALongWayApartTheWalkStillMatches() {
        let base = (0..<300).map { "line \($0 % 13)" }
        var other: [String] = []
        for (index, line) in base.enumerated() {
            if index % 3 == 0 { continue }
            if index % 7 == 0 {
                other.append("changed \(index)")
                continue
            }
            if index % 11 == 0 { other.append("added") }
            other.append(line)
        }
        let changes = ThreeWayMerge.diffLines(base, other)
        XCTAssertEqual(changes.count, 107)
        XCTAssertEqual(changes.reduce(0) { $0 + $1.baseEnd - $1.baseStart + $1.otherEnd - $1.otherStart }, 172)
        XCTAssertEqual(
            changes.prefix(6).map { [$0.baseStart, $0.baseEnd, $0.otherStart, $0.otherEnd] },
            [[0, 1, 0, 0], [3, 4, 2, 2], [6, 8, 4, 5], [9, 10, 6, 6], [11, 11, 7, 8], [12, 13, 9, 9]])
        XCTAssertEqual(
            changes.suffix(3).map { [$0.baseStart, $0.baseEnd, $0.otherStart, $0.otherEnd] },
            [[291, 292, 210, 210], [294, 295, 212, 212], [297, 298, 214, 214]])
        XCTAssertEqual(rebuild(base, other), other)
    }

    func testTwoFilesWithNothingInCommonAreOneChange() {
        XCTAssertEqual(
            ThreeWayMerge.diffLines(["a", "b"], ["x", "y"]),
            [MergeChange(baseStart: 0, baseEnd: 2, otherStart: 0, otherEnd: 2)])
    }

    func testBlocksAndFingerprintsMatchTheDaemon() {
        XCTAssertEqual(
            summary(ThreeWayMerge.splitBlocks(base: ["a", "b", "c"], ours: ["a", "ours", "c"], theirs: ["a", "theirs", "c"])),
            ["stable 1 1 1 26cf67bf", "conflict 1 1 1 a0cfec7f", "stable 1 1 1 2f4023ff"])
        XCTAssertEqual(
            summary(ThreeWayMerge.splitBlocks(base: ["a"], ours: ["é", "日本"], theirs: ["😀"])),
            ["conflict 1 2 1 d9b90e82"])
        XCTAssertEqual(ThreeWayMerge.splitBlocks(base: [], ours: [], theirs: []), [])
        XCTAssertEqual(
            summary(
                ThreeWayMerge.splitBlocks(
                    base: ["x", "y", "z", "w", "v"], ours: ["x", "y2", "z", "w", "v", "u"], theirs: ["q", "x", "y3", "z", "w"])),
            [
                "theirs 0 0 1 47a5f7f0", "stable 1 1 1 20b8223f", "conflict 1 1 1 2270a7a0", "stable 2 2 2 13b42c0b",
                "theirs 1 1 0 25114263", "ours 0 1 0 22f7b9e0",
            ])
    }

    func testALongerFileSplitsAsTheDaemonSplitsIt() {
        let base = (0..<40).map { "line \($0 % 7)" }
        let ours = base.enumerated().filter { $0.offset % 5 != 0 }.map(\.element).enumerated().map {
            $0.offset % 6 == 0 ? $0.element + "!" : $0.element
        }
        let theirs = base.enumerated().flatMap { $0.offset % 4 == 0 ? [$0.element, "added"] : [$0.element] }
        let blocks = ThreeWayMerge.splitBlocks(base: base, ours: ours, theirs: theirs)
        XCTAssertEqual(blocks.count, 33)
        XCTAssertEqual(
            Array(summary(blocks).prefix(5)),
            ["conflict 2 1 3 74660c74", "stable 3 3 3 beee1585", "conflict 1 0 2 d9482550", "stable 2 2 2 4e0f1f6f", "ours 1 1 1 da39375a"])
        XCTAssertEqual(summary(blocks)[19], "conflict 1 0 2 034aa605")
        XCTAssertEqual(summary(blocks).last, "stable 1 1 1 a8480c3f")
    }

    func testAChangeOnOneSideAloneMergesByItself() {
        let blocks = ThreeWayMerge.splitBlocks(base: ["a", "b", "c", "d", "e"], ours: ["ours", "b", "c", "d", "e"], theirs: ["a", "b", "c", "d", "theirs"])
        XCTAssertEqual(blocks.map(\.kind), [.ours, .stable, .theirs])
        XCTAssertEqual(blocks.flatMap { ThreeWayMerge.autoLines($0) ?? [] }, ["ours", "b", "c", "d", "theirs"])
    }

    func testBothSidesAddingInTheSamePlaceIsAConflict() {
        let blocks = ThreeWayMerge.splitBlocks(base: ["a", "b"], ours: ["a", "ours", "b"], theirs: ["a", "theirs", "b"])
        XCTAssertEqual(blocks.map(\.kind), [.stable, .conflict, .stable])
        XCTAssertEqual(ThreeWayMerge.bothLines(blocks[1], oursFirst: false), ["theirs", "ours"])
    }

    func testTheWandClosesOnlyWhatNeedsNoChoice() {
        let cases: [(base: [String], ours: [String], theirs: [String], wand: [String]?)] = [
            (["a"], ["const x = 1;"], ["const  x   = 1;"], ["const x = 1;"]),
            (["a"], ["one", "two"], ["one"], ["one", "two"]),
            (["a"], ["ours"], ["theirs"], nil),
            (["old1", "old2"], ["import NEW", "old1", "old2"], ["import NEW"], nil),
            (["old"], ["new", "more"], ["new"], ["new", "more"]),
            (["    x = 1"], ["    x = 2"], ["x = 2"], nil),
            (["\tx = 1"], ["\tx = 2"], ["    x = 2"], nil),
            (["    x = 1"], ["    x = 2;"], ["    x  =  2;  "], ["    x = 2;"]),
            (["x = 1"], ["x = 2", ""], ["x = 2", "    "], ["x = 2", ""]),
        ]
        for entry in cases {
            let blocks = ThreeWayMerge.splitBlocks(
                base: ["start"] + entry.base + ["end"], ours: ["start"] + entry.ours + ["end"],
                theirs: ["start"] + entry.theirs + ["end"])
            let conflict = blocks.first { $0.kind == .conflict }!
            XCTAssertEqual(ThreeWayMerge.wandLines(conflict), entry.wand, "\(entry.ours) against \(entry.theirs)")
        }
    }

    func testAFileKeepsItsLineEndingsAndItsLastNewline() {
        let crlf = "a\r\nb\r\n"
        XCTAssertEqual(ThreeWayMerge.shapeOf(crlf), MergeTextShape(eol: "\r\n", finalNewline: true))
        XCTAssertEqual(ThreeWayMerge.splitLines(crlf), ["a", "b"])
        XCTAssertEqual(ThreeWayMerge.joinLines(ThreeWayMerge.splitLines(crlf), shape: ThreeWayMerge.shapeOf(crlf)), crlf)
        let open = "a\nb"
        XCTAssertEqual(ThreeWayMerge.joinLines(ThreeWayMerge.splitLines(open), shape: ThreeWayMerge.shapeOf(open)), open)
        XCTAssertEqual(ThreeWayMerge.joinLines(ThreeWayMerge.splitLines(""), shape: ThreeWayMerge.shapeOf("")), "")
        XCTAssertEqual(ThreeWayMerge.splitLines("a\rb\n"), ["a\rb"])
    }
}
