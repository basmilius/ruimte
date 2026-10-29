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

    func testHeadingsFollowTheFlatScaleOfTheDesktop() {
        XCTAssertEqual(MarkdownHeading.font(1), .title3.weight(.semibold))
        XCTAssertEqual(MarkdownHeading.font(2), .headline)
        XCTAssertEqual(MarkdownHeading.font(4), .headline)
        XCTAssertEqual(MarkdownHeading.style(1), .title3)
        XCTAssertEqual(MarkdownHeading.style(3), .body)
    }

    func testInlineCodeAndPillsStandASizeBelowTheTextAroundThem() {
        XCTAssertEqual(ChatInlineFonts.style(of: nil), .body)
        XCTAssertEqual(ChatInlineFonts.style(of: .headline), .body)
        XCTAssertEqual(ChatInlineFonts.style(of: MarkdownHeading.font(1)), .title3)
        XCTAssertNil(ChatInlineFonts.style(of: .system(size: 14)))
        XCTAssertEqual(ChatInlineFonts.code(around: nil), .system(.subheadline, design: .monospaced))
        XCTAssertEqual(ChatInlineFonts.code(around: .footnote), .system(.caption2, design: .monospaced))
        XCTAssertEqual(ChatInlineFonts.code(around: MarkdownHeading.font(1)), .system(.body, design: .monospaced))
        XCTAssertEqual(ChatInlineFonts.chip(around: .body), .system(.footnote, weight: .medium))
        XCTAssertEqual(ChatInlineFonts.chip(around: .subheadline), .system(.caption, weight: .medium))
    }

    func testPicksAndInlineCodeBecomePaddedPillsButCodeAndAddressesStayAsTheyAre() {
        let source = MarkdownInline.parse("Read @a.ts with $review, not `@a.ts` or me@a.ts.", references: "")
        let marked = ChatInlineMarks.marked(source, font: nil, mentions: ["a.ts"], skills: ["review"], cwd: nil)
        let pills = marked.runs[ChatPillAttribute.self].compactMap { pill, range in
            pill.map { ($0.kind, String(marked[range].characters)) }
        }
        let pad = String(ChatInlineMarks.padding)
        XCTAssertEqual(pills.map(\.0), [.file("a.ts"), .skill, .code])
        XCTAssertEqual(pills.map(\.1), [pad + "@a.ts" + pad, pad + "$review" + pad, pad + "@a.ts" + pad])
        XCTAssertEqual(
            String(marked.characters),
            "Read \(pad)@a.ts\(pad) with \(pad)$review\(pad), not \(pad)@a.ts\(pad) or me@a.ts.")
        XCTAssertEqual(ChatPill(kind: .skill, id: 0).icon, "zap")
        XCTAssertEqual(ChatPill(kind: .file("src/"), id: 0).icon, "folder")
        XCTAssertNil(ChatPill(kind: .code, id: 0).icon)
    }

    func testListItemsStayTogetherAsOneGroup() {
        let groups = MarkdownBlock.grouped(MarkdownBlock.parse("Intro\n\n- One\n- Two\n\n1. Three\n\nOutro"))
        XCTAssertEqual(groups.map(\.count), [1, 3, 1])
    }

    @MainActor func testAReferenceBesideTheTextReadsItsCurrentNameOrSaysItWent() {
        let lookup = ChatReferenceLookup(
            items: [ChatReferable(id: "chat-1", name: "Release plan", kind: "chat", group: .views)], known: true)
        XCTAssertEqual(ChatReferenceChip.look("chat-1", chat: true, lookup: lookup).title, "Release plan")
        XCTAssertTrue(ChatReferenceChip.look("chat-1", chat: true, lookup: lookup).opens)
        XCTAssertEqual(ChatReferenceChip.look("chat-2", chat: true, lookup: lookup).title, "Not in this project")
        XCTAssertTrue(ChatReferenceChip.look("chat-2", chat: true, lookup: lookup).gone)
        XCTAssertEqual(ChatReferenceChip.look("chat-1", chat: true, lookup: ChatReferenceLookup()).title, "Chat")
    }

    func testAPickedReferenceIsANeutralChipThatOpensUnderItsCurrentName() {
        let source = MarkdownInline.parse("Look at #Sketch and `#Sketch`.", references: "")
        let lookup = ChatReferenceLookup(
            items: [ChatReferable(id: "sketch", name: "Sketch", kind: "drawing", group: .views)], known: true)
        let marked = ChatInlineMarks.marked(
            source, font: nil, mentions: [], skills: [], cwd: nil,
            references: ChatInlineReferences(
                picked: [ChatDraftReference(id: "sketch", title: "Sketch")], lookup: lookup))
        let pills = marked.runs[ChatPillAttribute.self].compactMap { pill, _ in pill?.kind }
        XCTAssertEqual(pills, [.reference("pen-tool"), .code])
        XCTAssertEqual(marked.runs[\.link].compactMap(\.0).first, ChatReferables.url("sketch"))
        XCTAssertEqual(ChatPill(kind: .reference("pen-tool"), id: 0).icon, "pen-tool")
    }

    func testAReplyNamesAViewByExactlyItsNameAndTheLongestNameWins() {
        let items = [
            ChatReferable(id: "q3", name: "Research Q3", kind: "chat", group: .views),
            ChatReferable(id: "research", name: "Research", kind: "note", group: .canvas),
            ChatReferable(id: "twin-a", name: "Twin", kind: "note", group: .canvas),
            ChatReferable(id: "twin-b", name: "Twin", kind: "chat", group: .views),
        ]
        let text = "See #Research Q3, (#Research) and a#Research, #Twin and #research."
        let found = ChatReferables.namedRanges(in: text, items: items, referenced: []).map(\.value)
        XCTAssertEqual(found, ["q3", "research"])
        XCTAssertEqual(
            ChatReferables.namedRanges(in: "#Twin", items: items, referenced: ["twin-b"]).map(\.value), ["twin-b"])
    }
}
