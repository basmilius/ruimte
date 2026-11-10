import RuimtePulsar
import XCTest

@testable import Ruimte

final class ProjectKindsTests: XCTestCase {
    func testEveryKindTheContractsNameHasARow() {
        let known = Set(ProjectKinds.all.map(\.kind))
        for kind in WireVocabulary.nodeKinds + WireVocabulary.viewKinds {
            XCTAssertTrue(known.contains(kind), "ProjectKinds has no row for \(kind)")
        }
    }

    func testNoRowNamesAKindTheContractsDoNot() {
        let wire = Set(WireVocabulary.nodeKinds + WireVocabulary.viewKinds)
        for row in ProjectKinds.all {
            XCTAssertTrue(wire.contains(row.kind), "\(row.kind) is no node or view kind")
        }
    }

    @MainActor func testAKindHasOneRowAndAMarkThatDraws() {
        XCTAssertEqual(Set(ProjectKinds.all.map(\.kind)).count, ProjectKinds.all.count)
        for row in ProjectKinds.all {
            XCTAssertNotNil(LucideIcon.icon(named: row.icon), "Missing Lucide shape \(row.icon) of \(row.kind)")
            if let reference = row.referenceIcon {
                XCTAssertNotNil(LucideIcon.icon(named: reference), "Missing Lucide shape \(reference)")
            }
            XCTAssertFalse(row.label.isEmpty)
        }
    }

    func testTheOfferedListsHoldKindsOfTheTable() {
        for kind in ProjectKinds.newView + ProjectKinds.addView + ProjectKinds.addNode {
            XCTAssertNotNil(ProjectKinds.row(kind), "\(kind) is offered but has no row")
        }
        let wireViews = Set(WireVocabulary.viewKinds)
        for kind in ProjectKinds.newView + ProjectKinds.addView {
            XCTAssertTrue(wireViews.contains(kind), "\(kind) is no view kind")
        }
        let wireNodes = Set(WireVocabulary.nodeKinds)
        for kind in ProjectKinds.addNode {
            XCTAssertTrue(wireNodes.contains(kind), "\(kind) is no node kind")
        }
    }

    func testAKindFromANewerMachineKeepsTheFallbacks() {
        XCTAssertNil(ProjectKinds.row("hologram"))
        XCTAssertEqual(ProjectKinds.label("hologram"), "Hologram")
        XCTAssertEqual(WorkspaceViewIcon.name(for: .object(["kind": .string("hologram")])), "circle-question-mark")
        XCTAssertFalse(ProjectKinds.isDivider("hologram"))
        XCTAssertFalse(ProjectKinds.waitsForSession("hologram"))
        XCTAssertFalse(ProjectKinds.editsOnCanvas("hologram"))
        XCTAssertEqual(ChatReferables.icon("hologram"), "file-text")
    }

    func testTheRulesThatHangOnAKind() {
        XCTAssertEqual(ProjectKinds.all.filter(\.isDivider).map(\.kind), ["separator", "subheader"])
        XCTAssertEqual(ProjectKinds.all.filter(\.waitsForSession).map(\.kind), ["canvas", "terminal", "group"])
        XCTAssertEqual(ProjectKinds.all.filter(\.runs).map(\.kind), ["chat", "terminal", "browser", "device"])
    }

    func testAReferenceWearsTheDesktopsReferenceMarkAndAListRowItsViewMark() {
        XCTAssertEqual(ChatReferables.icon("database"), "database")
        XCTAssertEqual(WorkspaceViewIcon.name(for: .object(["kind": .string("database")])), "table")
        XCTAssertEqual(ChatReferables.icon("project"), "folder")
        XCTAssertEqual(ChatReferables.icon("text"), "type")
    }
}
