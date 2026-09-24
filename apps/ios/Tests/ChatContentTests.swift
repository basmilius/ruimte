import XCTest

@testable import Ruimte

final class ChatContentTests: XCTestCase {
    func testNestedListsTasksAndMultilineQuotesRetainTheirStructure() {
        let blocks = MarkdownBlock.parse("- [x] Parent\n  continuation\n  - Child\n\n> First\n>\n> Second")
        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(blocks[0].kind, .list)
        XCTAssertEqual(blocks[0].checked, true)
        XCTAssertEqual(blocks[0].children[0].text, "Parent\ncontinuation")
        XCTAssertEqual(blocks[0].children[1].kind, .list)
        XCTAssertEqual(blocks[0].children[1].children[0].text, "Child")
        XCTAssertEqual(blocks[1].kind, .quote)
        XCTAssertEqual(blocks[1].children.map(\.text), ["First", "Second"])
    }

    func testFenceRequiresMatchingMarkerAndLength() {
        let blocks = MarkdownBlock.parse("````swift\nlet first = 1\n```\n~~~\nlet last = 2\n````")
        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].kind, .code("swift"))
        XCTAssertEqual(blocks[0].text, "let first = 1\n```\n~~~\nlet last = 2")
    }

    func testEscapedAndCodePipesDoNotSplitTableCells() {
        let blocks = MarkdownBlock.parse("| Command | Value |\n| --- | --- |\n| `a|b` | a\\|b |")
        XCTAssertEqual(blocks[0].rows, [["Command", "Value"], ["`a|b`", "a\\|b"]])
    }

    func testSettledBlocksPreserveLooseListsAndUnfinishedFences() {
        let text = "First\n\n- One\n\n- Two\n\n```swift\nlet value = 1\n\n"
        let segments = MarkdownSegments.split(text)
        XCTAssertEqual(segments.joined(), text)
        XCTAssertEqual(MarkdownSegments.settled(text), ["First\n\n- One\n\n- Two\n\n"])
        XCTAssertEqual(MarkdownSegments.settled("An unfinished paragraph\n\n"), [])
    }

    func testSettledSectionTitlesWaitForTheChunkUnderThem() {
        XCTAssertEqual(MarkdownSegments.settled("Intro\n\n# Plan\n\n## Setup\n\nInstall it"), ["Intro\n\n"])
        XCTAssertEqual(
            MarkdownSegments.settled("Intro\n\n## Setup\n\nInstall it.\n\nNext"),
            ["Intro\n\n", "## Setup\n\n", "Install it.\n\n"])
        XCTAssertEqual(MarkdownSegments.settled("Intro\n## Setup\n\nInstall"), ["Intro\n"])
        XCTAssertEqual(MarkdownSegments.settled("**Risk by area:**\n\n| a |\n|---|\n"), [])
        XCTAssertEqual(MarkdownSegments.settled("**Note:** read this.\n\nNext"), ["**Note:** read this.\n\n"])
        XCTAssertEqual(MarkdownSegments.settled("Intro\n**Setup**\n\nInstall"), ["Intro\n**Setup**\n\n"])
        XCTAssertEqual(MarkdownSegments.settled("## Code\n\n```swift\nlet a = 1\n\n"), [])
    }

    func testCachedParsingUpdatesTheOpenBlockAndHandlesReplacement() async {
        let cache = MarkdownBlockCache()
        let first = await cache.parse("# Title\n\nFirst")
        let second = await cache.parse("# Title\n\nFirst and second")
        XCTAssertEqual(first[0], second[0])
        XCTAssertEqual(second[1].text, "First and second")
        let replaced = await cache.parse("Replacement")
        XCTAssertEqual(replaced.map(\.text), ["Replacement"])
    }

    func testFileReferencesResolveOnTheMachineAndKeepLineNumbers() {
        XCTAssertEqual(
            ChatFileReference.parse("src/App.swift:42:7", cwd: "/project"),
            ChatFileReference(path: "/project/src/App.swift", line: 42))
        XCTAssertEqual(
            ChatFileReference.parse("../README.md#L12", cwd: "/project/src"),
            ChatFileReference(path: "/project/README.md", line: 12))
        XCTAssertEqual(
            ChatFileReference.parse("file:///project/My%20File.swift", cwd: "/elsewhere", explicit: true)?.path,
            "/project/My File.swift")
        XCTAssertNil(ChatFileReference.parse("https://example.com/App.swift", cwd: "/project", explicit: true))
        XCTAssertNil(ChatFileReference.parse("~/App.swift", cwd: "/project"))
        XCTAssertNil(ChatFileReference.parse("App.swift", cwd: ""))
        XCTAssertNil(ChatFileReference.parse("someFunction()", cwd: "/project"))
        let encoded = ChatFileReference.url("100%20.md")!
        XCTAssertEqual(
            ChatFileReference.parse(encoded.absoluteString, cwd: "/project", explicit: true)?.path, "/project/100%20.md"
        )
        XCTAssertNil(ChatFileReference.parse("#section", cwd: "/project", explicit: true))
    }

    func testReferenceDefinitionsResolveLinksWithoutBecomingParagraphs() {
        let source = "See [guide][ref].\n\n[ref]: https://example.com"
        let blocks = MarkdownBlock.parse(source)
        XCTAssertEqual(blocks.count, 1)
        let text = MarkdownInline.parse(blocks[0].text, references: MarkdownInline.references(source))
        XCTAssertEqual(String(text.characters), "See guide.")
        XCTAssertEqual(text.runs.compactMap(\.link), [URL(string: "https://example.com")!])
    }
}
