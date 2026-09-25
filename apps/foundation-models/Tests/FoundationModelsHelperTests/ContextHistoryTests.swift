import FoundationModels
import Testing
@testable import FoundationModelsHelper

private let instructions = Transcript.Entry.instructions(.init(id: "instructions", segments: [], toolDefinitions: []))

private func prompt(_ id: String) -> Transcript.Entry {
    .prompt(.init(id: id, segments: [.text(.init(content: id))]))
}

@Test func restoringUpdatesInstructionsWithoutLosingConversation() {
    let current = Transcript.Entry.instructions(.init(id: "current", segments: [.text(.init(content: "Continue paginated reads."))], toolDefinitions: []))
    let output = Transcript.Entry.toolOutput(.init(id: "read", toolName: "read_file", segments: [.text(.init(content: "saved content"))]))
    let conversation = [prompt("saved"), output]
    let refreshed = ContextHistory.refreshInstructions([instructions] + conversation, from: [current])
    #expect(refreshed == [current] + conversation)
    #expect(ContextHistory.refreshInstructions(refreshed, from: [current]) == refreshed)
}
