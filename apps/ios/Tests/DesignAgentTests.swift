import RuimtePulsar
import XCTest

@testable import Ruimte

final class DesignAgentTests: XCTestCase {
    private func page(_ name: String, _ mtime: Double) -> FsEntry {
        FsEntry(name: name, path: "/designs/\(name)", kind: .file, size: 1, mtime: mtime, hidden: false, ignored: false)
    }

    func testTheResultNamesAPageByItsNameInAPathOrALink() {
        let pages = ["Pricing.html", "Old Pricing.html", "Home.html"]
        XCTAssertEqual(
            DesignAgentPages.firstNamedPage("Look at Home.html first, then Pricing.html", pages: pages), "Home.html")
        XCTAssertEqual(DesignAgentPages.firstNamedPage("Start with Old Pricing.html", pages: pages), "Old Pricing.html")
        XCTAssertEqual(
            DesignAgentPages.firstNamedPage("[open](designs/site/Old%20Pricing.html)", pages: pages), "Old Pricing.html"
        )
        XCTAssertNil(DesignAgentPages.firstNamedPage("See MyHome.html and Home.html-old", pages: pages))
        XCTAssertNil(DesignAgentPages.firstNamedPage("No page here", pages: pages))
    }

    func testTheCardShowsThePickedPageThenTheNamedOneOnceDoneThenTheNewest() {
        let newestFirst = ["Pricing.html", "Home.html"]
        XCTAssertEqual(DesignAgentPages.cardPage(newestFirst, picked: "Home.html", result: "Pricing.html"), "Home.html")
        XCTAssertEqual(DesignAgentPages.cardPage(newestFirst, picked: "Gone.html", result: nil), "Pricing.html")
        XCTAssertEqual(
            DesignAgentPages.cardPage(newestFirst, picked: nil, result: "Open Home.html first."), "Home.html")
        XCTAssertEqual(DesignAgentPages.cardPage(newestFirst, picked: nil, result: "Done."), "Pricing.html")
        XCTAssertNil(DesignAgentPages.cardPage([], picked: nil, result: nil))
    }

    func testThePickerListsPagesByNameWithNumbersInOrder() {
        XCTAssertEqual(
            DesignAgentPages.byName(["Page 10.html", "page 2.html", "About.html"]),
            ["About.html", "page 2.html", "Page 10.html"])
    }

    func testAnOpenedDesignFollowsTheNewestPageUntilOneIsPicked() {
        var follow = DesignFollow(shown: "Home.html", picked: false)
        follow.update([page("Pricing.html", 2), page("Home.html", 1)])
        XCTAssertEqual(follow.shown, "Home.html", "it starts on the card's page")
        follow.update([page("Pricing.html", 3), page("Home.html", 1)])
        XCTAssertEqual(follow.shown, "Pricing.html", "a page written after it opened comes into view")
        follow.pick("Home.html")
        follow.update([page("About.html", 4), page("Pricing.html", 3), page("Home.html", 1)])
        XCTAssertEqual(follow.shown, "Home.html", "a picked page stays")
        follow.update([page("About.html", 4)])
        XCTAssertEqual(follow.shown, "About.html", "a picked page that is gone gives way to the newest")
        XCTAssertFalse(follow.picked)
    }

    func testAnOpenedDesignWithoutPagesShowsTheFirstOneWritten() {
        var follow = DesignFollow(shown: nil, picked: false)
        follow.update([])
        XCTAssertNil(follow.shown)
        follow.update([page("Home.html", 1)])
        XCTAssertEqual(follow.shown, "Home.html")
    }

    func testAFileAnAgentKeepsForItselfIsNoPage() {
        let pages = DesignFiles.pages([page("_notes.html", 3), page(".draft.html", 2), page("Home.html", 1)])
        XCTAssertEqual(pages.map(\.name), ["Home.html"])
    }
}
