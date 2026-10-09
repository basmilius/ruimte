import Testing
import RuimtePulsar
@testable import RuimteIntelligentUI

struct UiReplyPartsTests {
    private func block(_ id: String, _ start: Double, _ end: Double, complete: Bool = true) -> JSONValue {
        .object(["id": .string(id), "start": .number(start), "end": .number(end), "complete": .bool(complete)])
    }

    @Test func offsetsMatchJavaScriptAndPreserveProse() {
        let block = block("a", 3, 7)
        #expect(UiReplyParts.split(text: "🐇 code after", blocks: [block]) == [.text("🐇 "), .block(block), .text(" after")])
    }

    @Test func partialBlockHoldsUncompiledTailAndMalformedOffsetsLeaveText() {
        let block = block("a", 3, 7, complete: false)
        #expect(UiReplyParts.split(text: "🐇 code tail", blocks: [block], streaming: true) == [.text("🐇 "), .block(block)])
        for invalid in [self.block("bad", 1, 2), self.block("bad", 0, 999), self.block("bad", -1, 2), self.block("bad", 1.5, 2)] {
            #expect(UiReplyParts.split(text: "🐇 code", blocks: [invalid]) == [.text("🐇 code")])
        }
    }

    @Test func overlappingAndDuplicateBlocksNeverRepeatText() {
        let first = block("a", 0, 3)
        let duplicate = block("a", 4, 6)
        let overlap = block("b", 2, 4)
        #expect(UiReplyParts.split(text: "one two", blocks: [duplicate, overlap, first]) == [.block(first), .text(" two")])
    }
}
