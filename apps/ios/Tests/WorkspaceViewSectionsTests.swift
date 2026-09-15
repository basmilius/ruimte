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
        let sections = WorkspaceViewSections.split(views)
        XCTAssertEqual(sections.map(\.id), [.leading, .separator("named"), .separator("empty")])
        XCTAssertEqual(sections.map(\.title), [nil, "Work", nil])
        XCTAssertEqual(sections.map { $0.items.map(\.stableID) }, [["leading"], ["chat"], ["terminal"]])
    }

    func testLeadingAndConsecutiveSeparatorsDoNotCreateEmptyItems() {
        let sections = WorkspaceViewSections.split([
            separator("first", "Unused"), separator("second", "Used"), view("chat"), separator("last"),
        ])
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections.first?.title, "Used")
        XCTAssertEqual(sections.first?.id, .separator("second"))
        XCTAssertTrue(WorkspaceViewSections.split([separator("only")]).isEmpty)
    }

    func testSearchPreservesSectionMembershipAndCannotExposeSeparatorsAsRows() {
        let views = [view("first", "Alpha"), separator("work", "Work"), view("second", "Beta"), view("third", "Alpha")]
        let sections = WorkspaceViewSections.split(views, search: "alpha")
        XCTAssertEqual(sections.map(\.id), [.leading, .separator("work")])
        XCTAssertEqual(sections.map { $0.items.map(\.stableID) }, [["first"], ["third"]])
        XCTAssertTrue(WorkspaceViewSections.split(views, search: "Work").isEmpty)
        XCTAssertNil(
            WorkspaceViewSections.moving(
                views, sectionID: .separator("work"), expectedIDs: ["third"], from: [0], to: 1))
    }

    func testReorderUsesSectionLocalOffsetsAndPreservesSeparatorSlots() throws {
        let views = [
            view("before"), separator("work", "Work"), view("a"), view("b"), view("c"), separator("after"),
            view("last"),
        ]
        let moved = try XCTUnwrap(
            WorkspaceViewSections.moving(
                views, sectionID: .separator("work"), expectedIDs: ["a", "b", "c"], from: [0], to: 3))
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
                views, sectionID: .separator("removed"), expectedIDs: ["a", "b"], from: [0], to: 2))
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
            "drawing": "pen-tool", "diagram": "workflow", "file": "file-text", "unknown": "circle-question-mark",
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

    private func view(_ id: String, _ name: String? = nil) -> JSONValue {
        .object(["id": .string(id), "kind": .string("chat"), "name": .string(name ?? id)])
    }
    private func separator(_ id: String, _ name: String = "") -> JSONValue {
        .object(["id": .string(id), "kind": .string("separator"), "name": .string(name)])
    }
}
