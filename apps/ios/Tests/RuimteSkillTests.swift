import Foundation
import XCTest

@testable import Ruimte

final class RuimteSkillTests: XCTestCase {
    private let design = RuimteSkill(name: "ruimte-design", title: "design", description: "Design pages with an agent.")

    func testASkillRuimteShipsReadsAsItsTitle() {
        XCTAssertEqual(RuimteSkillNames.title(of: "ruimte-design"), "design")
        XCTAssertEqual(RuimteSkillNames.title(of: "ruimte-site-map"), "site-map")
        XCTAssertNil(RuimteSkillNames.title(of: "review"))
        XCTAssertNil(RuimteSkillNames.title(of: "ruimte-"))
        XCTAssertNil(RuimteSkillNames.title(of: "ruimte-Design"))
        XCTAssertEqual(RuimteSkillNames.spelled("ruimte-design"), "design")
        XCTAssertEqual(RuimteSkillNames.spelled("review"), "review")
    }

    func testATextNamesEachSkillByItsTitleAsTheDesktopDoes() {
        XCTAssertEqual(
            RuimteSkillNames.withTitles("Maak een $ruimte-design van de loginpagina"),
            "Maak een $design van de loginpagina")
        XCTAssertEqual(
            RuimteSkillNames.withTitles("$ruimte-design (sign up) and $ruimte-designer"),
            "$design (sign up) and $designer")
        XCTAssertEqual(
            RuimteSkillNames.withTitles("Use a$ruimte-design or $ruimte-design:x"),
            "Use a$ruimte-design or $ruimte-design:x")
        XCTAssertEqual(NodeTitle.derive("$ruimte-design a login page"), "$design a login page")
    }

    func testAPickedSkillStandsInTheDraftByItsTitleAndGoesOutByItsName() {
        let text = "Make a $design of $review now"
        let tokens = ChatDraftSyntax.tokens(in: text, mentions: [], skills: ["review", "ruimte-design"])
        XCTAssertEqual(tokens.map(\.value), ["ruimte-design", "review"])
        XCTAssertEqual(ChatDraftSyntax.sentText(text, tokens: tokens), "Make a $ruimte-design of $review now")
    }

    func testSentTextComesBackIntoADraftByItsTitles() {
        XCTAssertEqual(
            ChatDraftSyntax.draftText("Make a $ruimte-design of $review", skills: ["ruimte-design", "review"]),
            "Make a $design of $review")
        XCTAssertEqual(ChatDraftSyntax.draftText("Make a $ruimte-design", skills: []), "Make a $ruimte-design")
    }

    func testTheThreadFindsASentSkillByItsName() {
        let tokens = ChatDraftSyntax.tokens(
            in: "Make a $ruimte-design", mentions: [], skills: ["ruimte-design"], skillsByName: true)
        XCTAssertEqual(tokens.map(\.range), [NSRange(location: 7, length: 14)])
    }

    func testTheMenuFiltersRuimtesSkillsOnTitleAndName() {
        XCTAssertEqual(ChatSuggestion.ruimteSkills([design], query: "").map(\.title), ["design"])
        XCTAssertEqual(ChatSuggestion.ruimteSkills([design], query: "DES").map(\.value), ["ruimte-design"])
        XCTAssertEqual(ChatSuggestion.ruimteSkills([design], query: "ruimte").count, 1)
        XCTAssertTrue(ChatSuggestion.ruimteSkills([design], query: "review").isEmpty)
        XCTAssertTrue(ChatSuggestion.ruimteSkills([design], query: "").allSatisfy(\.ruimte))
    }

    func testTheThreadDrawsASentSkillAsAPillThatReadsItsTitle() {
        let marked = ChatInlineMarks.marked(
            AttributedString("Make a $ruimte-design now"), font: nil, mentions: [], skills: ["ruimte-design"], cwd: nil)
        let plain = String(marked.characters).replacingOccurrences(of: String(ChatInlineMarks.padding), with: "")
        XCTAssertEqual(plain, "Make a $design now")
        XCTAssertTrue(marked.runs[ChatPillAttribute.self].contains { $0.0?.kind == .ruimteSkill })
    }
}
