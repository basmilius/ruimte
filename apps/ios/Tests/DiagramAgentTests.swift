import Foundation
import RuimtePulsar
import Testing

@testable import Ruimte

@Suite struct DiagramAgentTests {
    private let views: [JSONValue] = [
        .object(["id": .string("chat-a"), "kind": .string("chat"), "name": .string("Plan")]),
        .object([
            "id": .string("canvas"), "kind": .string("canvas"),
            "nodes": .array([
                .object(["id": .string("chat-b"), "kind": .string("chat")]),
                .object(["id": .string("diagram-node"), "kind": .string("diagram")]),
            ]),
        ]),
        .object(["id": .string("diagram-view"), "kind": .string("diagram")]),
        .object(["id": .string("notes"), "kind": .string("file")]),
    ]

    @Test func anEmptyDiagramAsksForWhatItShouldShow() {
        let text = DiagramAgentPrompt.text(
            name: "Data model", diagramID: "d1", request: " the tables and their relations \n", empty: true)
        #expect(
            text
                == "Fill the empty diagram \"Data model\" with `ruimte-context view diagram d1`. It should show the tables and their relations"
        )
    }

    @Test func aChangeNamesTheVerbAndTheFileItIsIn() {
        let text = DiagramAgentPrompt.text(name: "Architecture", diagramID: "d2", request: "Add Redis.", empty: false)
        #expect(text.contains("`ruimte-context view diagram d2`"))
        #expect(text.contains(".ruimte/diagrams/d2.json"))
        #expect(text.hasSuffix("Add Redis."))
    }

    @Test func theChatsOfAProjectAreItsChatViewsThenItsChatNodes() {
        #expect(DiagramAgentPrompt.chats(in: views).map(\.stableID) == ["chat-a", "chat-b"])
    }

    @Test func aNewChatGoesRightAfterTheDiagramOrTheCanvasThatHoldsIt() {
        let view = views[2]
        #expect(DiagramAgentPrompt.insertion(after: view, in: views) == 3)
        let node = views[1].list("nodes")[1]
        #expect(DiagramAgentPrompt.insertion(after: node, in: views) == 2)
        #expect(DiagramAgentPrompt.insertion(after: .object(["id": .string("gone")]), in: views) == 4)
    }
}
