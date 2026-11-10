import RuimtePulsar
import UIKit
import XCTest

@testable import Ruimte

final class WorkspaceViewSectionsTests: XCTestCase {
    func testSeparatorsBecomeSectionsWithoutBlankRowsOrEmptyHeadings() {
        let views = [
            view("leading"), separator("named", "Work"), view("chat"),
            separator("empty", "  \n"), view("terminal"), separator("trailing", "Later"),
        ]
        let sections = WorkspaceViewSections.split(items(views))
        XCTAssertEqual(sections.map(\.id), [.leading, .divider("named"), .divider("empty")])
        XCTAssertEqual(sections.map(\.title), [nil, "Work", nil])
        XCTAssertEqual(sections.map { $0.items.map(\.id) }, [["leading"], ["chat"], ["terminal"]])
    }

    func testLeadingAndConsecutiveSeparatorsDoNotCreateEmptyItems() {
        let sections = WorkspaceViewSections.split(items([
            separator("first", "Unused"), separator("second", "Used"), view("chat"), separator("last"),
        ]))
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections.first?.title, "Used")
        XCTAssertEqual(sections.first?.id, .divider("second"))
        XCTAssertTrue(WorkspaceViewSections.split(items([separator("only")])).isEmpty)
    }

    func testSubheadersOpenASectionUnderTheirOwnTextAndKeepTheirSlot() throws {
        let views = [view("leading"), subheader("work", "Work"), view("a"), view("b"), separator("line"), view("terminal")]
        let sections = WorkspaceViewSections.split(items(views))
        XCTAssertEqual(sections.map(\.id), [.leading, .divider("work"), .divider("line")])
        XCTAssertEqual(sections.map(\.title), [nil, "Work", nil])
        XCTAssertEqual(sections.map { $0.items.map(\.id) }, [["leading"], ["a", "b"], ["terminal"]])
        // A heading divides the list rather than standing in it, so a reorder never moves into its slot.
        let moved = try XCTUnwrap(
            WorkspaceViewSections.moving(
                views, sectionID: .divider("work"), expectedIDs: ["a", "b"], from: [0], to: 2))
        XCTAssertEqual(moved.map(\.stableID), ["leading", "work", "b", "a", "line", "terminal"])
        XCTAssertEqual(moved[1], views[1])
    }

    func testSearchPreservesSectionMembershipAndCannotExposeSeparatorsAsRows() {
        let views = [view("first", "Alpha"), separator("work", "Work"), view("second", "Beta"), view("third", "Alpha")]
        let sections = WorkspaceViewSections.split(items(views), search: "alpha")
        XCTAssertEqual(sections.map(\.id), [.leading, .divider("work")])
        XCTAssertEqual(sections.map { $0.items.map(\.id) }, [["first"], ["third"]])
        XCTAssertTrue(WorkspaceViewSections.split(items(views), search: "Work").isEmpty)
        XCTAssertNil(
            WorkspaceViewSections.moving(
                views, sectionID: .divider("work"), expectedIDs: ["third"], from: [0], to: 1))
    }

    func testReorderUsesSectionLocalOffsetsAndPreservesSeparatorSlots() throws {
        let views = [
            view("before"), separator("work", "Work"), view("a"), view("b"), view("c"), separator("after"),
            view("last"),
        ]
        let moved = try XCTUnwrap(
            WorkspaceViewSections.moving(
                views, sectionID: .divider("work"), expectedIDs: ["a", "b", "c"], from: [0], to: 3))
        XCTAssertEqual(moved.map(\.stableID), ["before", "work", "b", "c", "a", "after", "last"])
        XCTAssertEqual(moved[1], views[1])
        XCTAssertEqual(moved[5], views[5])
    }

    func testMultipleRowsMoveInOriginalOrderAndDestinationUsesPreMoveIndices() throws {
        let views = [view("a"), view("b"), view("c"), view("d"), separator("tail")]
        let moved = try XCTUnwrap(
            WorkspaceViewSections.moving(
                views, sectionID: .leading, expectedIDs: ["a", "b", "c", "d"], from: [0, 2], to: 4))
        XCTAssertEqual(moved.map(\.stableID), ["b", "d", "a", "c", "tail"])
    }

    func testReorderPreservesRemoteContentButRefusesChangedMembership() throws {
        let views = [view("a", "Remote title"), view("b"), separator("next"), view("remote")]
        let moved = try XCTUnwrap(
            WorkspaceViewSections.moving(
                views, sectionID: .leading, expectedIDs: ["a", "b"], from: [0], to: 2))
        XCTAssertEqual(moved[1].text("name"), "Remote title")
        XCTAssertEqual(moved.last, views.last)
        XCTAssertNil(
            WorkspaceViewSections.moving(
                [view("inserted")] + views, sectionID: .leading, expectedIDs: ["a", "b"], from: [0], to: 2))
        XCTAssertNil(
            WorkspaceViewSections.moving(
                views, sectionID: .divider("removed"), expectedIDs: ["a", "b"], from: [0], to: 2))
    }

    func testInvalidOffsetsOrDuplicateIDsCannotCorruptAnotherSection() {
        let views = [view("a"), view("b")]
        XCTAssertNil(
            WorkspaceViewSections.moving(views, sectionID: .leading, expectedIDs: ["a", "b"], from: [2], to: 0))
        XCTAssertNil(
            WorkspaceViewSections.moving(views, sectionID: .leading, expectedIDs: ["a", "b"], from: [0], to: 3))
        XCTAssertNil(
            WorkspaceViewSections.moving(
                views + [separator("next"), view("a")], sectionID: .leading, expectedIDs: ["a", "b"], from: [0], to: 2))
    }

    @MainActor func testDesktopViewGlyphsAndChosenIconsHaveNativeLucideShapes() {
        let expected = [
            "canvas": "frame", "chat": "message-square", "terminal": "terminal", "browser": "globe",
            "drawing": "pen-tool", "diagram": "workflow", "file": "file-text", "database": "table", "unknown": "circle-question-mark",
            "separator": "minus", "subheader": "heading",
        ]
        for (kind, icon) in expected {
            let item = view(kind).setting("kind", .string(kind))
            XCTAssertEqual(WorkspaceViewIcon.name(for: item), icon)
            XCTAssertNotNil(LucideIcon.icon(named: icon), "Missing Lucide shape \(icon)")
        }
        let chosen = view("chat").setting("icon", .object(["kind": .string("lucide"), "value": .string("rocket")]))
        XCTAssertEqual(WorkspaceViewIcon.name(for: chosen), "rocket")
        XCTAssertNotNil(LucideIcon.icon(named: "rocket"))
        XCTAssertEqual(WorkspaceViewIcon.name(for: chosen.setting("kind", .string("unknown"))), "circle-question-mark")
    }

    func testAChatNobodyWroteInKeepsItsSlotWhileTheListedRowsMove() throws {
        let empty = view("new").setting("empty", .bool(true))
        let views = [view("a"), empty, view("c"), view("d")]
        let listed = { WorkspaceViewSections.isListed($0, selectedID: nil) }
        XCTAssertEqual(items(views).filter(listed).map(\.id), ["a", "c", "d"])
        XCTAssertTrue(WorkspaceViewSections.isListed(item(empty), selectedID: "new"))
        let moved = try XCTUnwrap(
            WorkspaceViewSections.moving(
                views, sectionID: .leading, expectedIDs: ["a", "c", "d"], from: [2], to: 0, listed: listed))
        XCTAssertEqual(moved.map(\.stableID), ["d", "new", "a", "c"])
        XCTAssertEqual(moved[1], empty)
    }

    func testAHiddenViewIsNeverListedAndKeepsItsSlot() throws {
        let canvas = ProjectWire.view(
            .object(["id": .string("peer"), "kind": .string("canvas"), "name": .string("MacBook Pro"), "hidden": .bool(true)]))
        let inline = view("inline").setting("hidden", .bool(true))
        let views = [view("a"), canvas, view("b"), inline]
        let listed = { WorkspaceViewSections.isListed($0, selectedID: "peer") }
        XCTAssertEqual(items(views).filter(listed).map(\.id), ["a", "b"])
        XCTAssertFalse(WorkspaceViewSections.isListed(item(inline), selectedID: "inline"))
        let moved = try XCTUnwrap(
            WorkspaceViewSections.moving(
                views, sectionID: .leading, expectedIDs: ["a", "b"], from: [1], to: 0, listed: listed))
        XCTAssertEqual(moved.map(\.stableID), ["b", "peer", "a", "inline"])
    }

    private func items(_ views: [JSONValue]) -> [ProjectItem] { views.map(item) }
    private func item(_ view: JSONValue) -> ProjectItem { ProjectWire.item(view) }

    private func view(_ id: String, _ name: String? = nil) -> JSONValue {
        ProjectWire.view(.object(["id": .string(id), "kind": .string("chat"), "name": .string(name ?? id)]))
    }
    private func separator(_ id: String, _ name: String = "") -> JSONValue {
        ProjectWire.view(.object(["id": .string(id), "kind": .string("separator"), "name": .string(name)]))
    }
    private func subheader(_ id: String, _ name: String) -> JSONValue {
        ProjectWire.view(.object(["id": .string(id), "kind": .string("subheader"), "name": .string(name)]))
    }

    func testEveryIconGroupTheContractsNameHasALabel() {
        for group in WireVocabulary.projectIconGroups {
            XCTAssertNotNil(IconChoiceGrid.groupLabel(group.id), "No label for the icon group \(group.id)")
        }
    }

    @MainActor func testEveryIconOfTheContractsHasAShapeAndEveryKeywordNamesAnIcon() {
        let names = Set(WireVocabulary.projectIconGroups.flatMap(\.names))
        for name in names {
            XCTAssertNotNil(LucideIcon.icon(named: name), "Missing Lucide shape \(name)")
        }
        for name in WireVocabulary.projectIconKeywords.keys {
            XCTAssertTrue(names.contains(name), "Keywords for \(name), which no group offers")
        }
    }
}
