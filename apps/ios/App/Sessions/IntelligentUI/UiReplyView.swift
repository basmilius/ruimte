import RuimteIntelligentUI
import RuimtePulsar
import SwiftUI

/// A reply whose text holds blocks: the prose around the cards stays prose, and each compiled block is a card in
/// its place, split on the daemon's UTF-16 offsets. A block that is supplied never falls back to its raw fence;
/// what it cannot draw, the card itself shows as text.
struct UiReplyView: View {
    /// The assistant item: `text`, `streaming`, `ui`, `uiAnswers` and `uiQueries` as the wire has them.
    let item: JSONValue
    var presentation: ChatPresentation?
    /// The model of a block, kept by the caller across rows (`UiBlockModelCache`), created with the block it draws.
    let model: @MainActor (JSONValue) -> UiBlockModel
    @Environment(\.chatContent) private var chat

    /// Whether a reply has compiled blocks to draw; without them the thread draws its text as it always did.
    static func hasBlocks(_ item: JSONValue) -> Bool { !(item["ui"]?.arrayValue ?? []).isEmpty }

    var body: some View {
        let streaming = item["streaming"]?.boolValue == true
        let text = item["text"]?.stringValue ?? ""
        let parts = Self.identified(
            UiReplyParts.split(text: text, blocks: item["ui"]?.arrayValue ?? [], streaming: streaming))
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(parts.enumerated()), id: \.element.id) { index, part in
                switch part.part {
                case .text(let text):
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        ChatStreamingMessage(text: text, streaming: streaming && index == parts.count - 1)
                    }
                case .block(let block):
                    let id = block["id"]?.stringValue ?? ""
                    UiReplyBlock(
                        block: block, model: model(block), flash: highlight(block),
                        frozen: item["uiQueries"]?["blocks"]?[id],
                        answered: item["uiAnswers"]?[id],
                        source: UiReplyParts.source(text: text, block: block),
                        localKey:
                            "\(chat?.scopeID ?? "")\n\(chat?.chatID ?? "")\n\(item["id"]?.stringValue ?? "")\n\(id)")
                }
            }
        }
    }

    private func highlight(_ block: JSONValue) -> UUID? {
        guard let target = presentation?.uiChoiceHighlight,
            target.itemID == item.text("id"), target.blockID == block.text("id"),
            target.revision == block.text("revision")
        else { return nil }
        return target.nonce
    }

    private struct Identified {
        let id: String
        let part: UiReplyPart
    }

    /// Text is keyed by the block before it, so a block that arrives leaves the prose before it where it was.
    private static func identified(_ parts: [UiReplyPart]) -> [Identified] {
        var after = "start"
        return parts.map { part in
            switch part {
            case .text: return Identified(id: "text:\(after)", part: part)
            case .block(let block):
                after = block["id"]?.stringValue ?? after
                return Identified(id: "block:\(after)", part: part)
            }
        }
    }
}

/// One card, which hands its model every new compile, the stored readings and the stored answer.
private struct UiReplyBlock: View {
    let block: JSONValue
    let model: UiBlockModel
    let flash: UUID?
    let frozen: JSONValue?
    let answered: JSONValue?
    let source: String?
    let localKey: String

    private struct Update: Equatable {
        let block: JSONValue
        let frozen: JSONValue?
        let answered: JSONValue?
        let source: String?
    }

    var body: some View {
        UiBlockView(model: model, localKey: localKey, flash: flash)
            .task(id: Update(block: block, frozen: frozen, answered: answered, source: source)) {
                await model.update(block: block, frozen: frozen, answered: answered, source: source)
            }
    }
}
