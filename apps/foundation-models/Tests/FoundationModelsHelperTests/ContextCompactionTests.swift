import FoundationModels
import Testing
@testable import FoundationModelsHelper

private func exchange(_ name: String) -> [Transcript.Entry] {
    [.prompt(.init(id: "prompt-\(name)", segments: [.text(.init(content: name))])),
     .response(.init(id: "response-\(name)", assetIDs: [], segments: [.text(.init(content: "Answer \(name)"))]))]
}

@Test func summaryKeepsRecentExchangesAndDoesNotMutateOriginalHistory() throws {
    let original = exchange("old") + exchange("middle") + exchange("recent")
    let plan = try #require(try ContextCompaction(original))
    #expect(plan.removed == Array(original.prefix(2)))
    let source = try plan.summarySource()
    #expect(source.contains("old"))
    #expect(!source.contains("middle"))
    #expect(!source.contains("prompt-old"))
    let result = Array(try plan.applying(summary: "A fallible summary."))
    #expect(Array(result.suffix(4)) == Array(original.suffix(4)))
    #expect(original.count == 6)
    #expect(throws: (any Error).self) { try plan.applying(summary: "  ") }
}

@Test func summaryInputRetainsStructuredAnswersAndToolResultsWithoutRepeatedResponseSchemas() throws {
    let call = Transcript.ToolCall(id: "read", toolName: "Read", arguments: GeneratedContent(properties: ["path": "README.md"]))
    let old: [Transcript.Entry] = [
        .prompt(.init(segments: [.text(.init(content: "Read the file."))], responseFormat: .init(type: AssistantReply.self))),
        .toolCalls(.init([call])),
        .toolOutput(.init(id: "read", toolName: "Read", segments: [.text(.init(content: "launch_day = Thursday"))])),
        .response(.init(assetIDs: [], segments: [.structure(.init(source: "AssistantReply", content: GeneratedContent(properties: ["message": "Launch is Thursday.", "needsUserInput": false])))]))
    ]
    let plan = try #require(try ContextCompaction(old + exchange("middle") + exchange("recent")))
    let source = try plan.summarySource()
    #expect(source.contains("launch_day = Thursday"))
    #expect(source.contains("Launch is Thursday."))
    #expect(source.contains("README.md"))
    #expect(!source.contains("responseFormat"))
    #expect(!source.contains("generationSchema"))
}

@Test func compactionRejectsAnOrphanOrIncompleteToolExchange() throws {
    let output = Transcript.Entry.toolOutput(.init(id: "call", toolName: "Read", segments: []))
    #expect(throws: (any Error).self) { try ContextCompaction.validate([output]) }
    let call = Transcript.ToolCall(id: "call", toolName: "Read", arguments: GeneratedContent(properties: ["path": "README.md"]))
    let start = exchange("old")[0]
    let end = exchange("old")[1]
    #expect(throws: (any Error).self) { try ContextCompaction.validate([start, .toolCalls(.init([call])), end]) }
    try ContextCompaction.validate([start, .toolCalls(.init([call])), output, end])
    #expect(throws: (any Error).self) {
        try ContextCompaction.validate([start, .toolCalls(.init([call, call])), output, end])
    }
}

@Test func manifestOrderDoesNotChangeCompatibilityButDefinitionsDo() throws {
    let bridge = ToolBridge(send: { _ in })
    let read = ReadFile(bridge: bridge)
    let list = ListFiles(bridge: bridge)
    #expect(try ToolManifest.fingerprint([read, list]) == ToolManifest.fingerprint([list, read]))
    #expect(try ToolManifest.fingerprint([read, list]) != ToolManifest.fingerprint([read]))
    #expect(throws: (any Error).self) { try ToolManifest.fingerprint([read, read]) }
}
