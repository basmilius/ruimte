import Testing
import RuimtePulsar
@testable import RuimteIntelligentUI

struct UiGeneratedImageTests {
    private func tool(size: Double = 512, mime: String = "image/png", state: String = "done") -> JSONValue {
        .object([
            "kind": .string("tool"), "name": .string("ImageGeneration"), "state": .string(state),
            "input": .object([
                "attachment": .object(["id": .string("image"), "name": .string("rabbit.png"), "mime": .string(mime), "size": .number(size), "width": .number(1536), "height": .number(1024)]),
                "revisedPrompt": .string(" A rabbit "), "transparentBackground": .bool(true),
            ]),
        ])
    }

    @Test func imageStatesComeOnlyFromTheToolAndStoredAttachment() {
        #expect(UiGeneratedImage.isGeneration(tool()))
        #expect(UiGeneratedImage.parse(tool(state: "running")) == .generating)
        guard case .ready(let attachment, let prompt, let transparent) = UiGeneratedImage.parse(tool()) else {
            Issue.record("The stored image was not ready")
            return
        }
        #expect(prompt == "A rabbit")
        #expect(transparent)
        #expect(UiGeneratedImage.aspect(attachment) == 1.5)
        #expect(UiGeneratedImage.aspect(.object(["width": .number(1), "height": .number(0)])) == nil)
    }

    @Test func emptyNonImageAndOversizedOutputsFail() {
        #expect(UiGeneratedImage.parse(tool(size: 0)) == .failed(.empty))
        #expect(UiGeneratedImage.parse(tool(mime: "text/plain")) == .failed(.notImage))
        #expect(UiGeneratedImage.parse(tool(size: Double(UiGeneratedImage.maxBytes + 1))) == .failed(.tooLarge))
        #expect(UiGeneratedImage.parse(tool(state: "error")) == .failed(.provider(nil)))
        let pathOnly: JSONValue = .object(["state": .string("done"), "input": .object(["path": .string("/agent/image.png")])])
        #expect(UiGeneratedImage.parse(pathOnly) == .failed(.empty))
    }
}
