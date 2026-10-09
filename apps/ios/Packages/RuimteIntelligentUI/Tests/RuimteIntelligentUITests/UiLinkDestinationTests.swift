import Testing
import RuimtePulsar
@testable import RuimteIntelligentUI

struct UiLinkDestinationTests {
    @Test func onlyValidatedLinksInTheCurrentProjectOpen() {
        let reading: JSONValue = .object([
            "state": .string("chip"), "projectId": .string("p"),
            "target": .object(["type": .string("File"), "path": .string("/project/readme.md"), "line": .number(7)]),
        ])
        #expect(UiLinkDestination.parse(reading, projectID: "p") == .file(path: "/project/readme.md", line: 7))
        #expect(UiLinkDestination.parse(reading, projectID: "other") == nil)
        #expect(UiLinkDestination.parse(reading, projectID: nil) == nil)
        #expect(UiLinkDestination.parse(.object(["state": .string("plain")]), projectID: "p") == nil)
    }

    @Test func diffsPreserveTheRepositoryAndStagedConflictState() {
        let reading: JSONValue = .object([
            "state": .string("chip"), "projectId": .string("p"), "cwd": .string("/worktree"),
            "relativePath": .string("src/a.ts"), "staged": .bool(true), "conflicted": .bool(true),
            "target": .object(["type": .string("Diff"), "path": .string("/worktree/src/a.ts")]),
        ])
        #expect(UiLinkDestination.parse(reading, projectID: "p") == .diff(cwd: "/worktree", path: "src/a.ts", staged: true, conflicted: true))
    }

    @Test func externalLinksNeverOpenAnotherScheme() {
        #expect(UiLinkDestination.externalURL("https://example.com/page") != nil)
        for url in ["javascript:alert(1)", "file:///project/a", "ruimte://open", "data:text/html,hello", "https:"] {
            #expect(UiLinkDestination.externalURL(url) == nil)
        }
    }
}
