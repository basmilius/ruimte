import Foundation
import RuimtePulsar

public enum UiGeneratedImage: Equatable, Sendable {
    public enum Failure: Equatable, Sendable {
        case provider(String?)
        case empty
        case notImage
        case tooLarge
    }
    case generating
    case failed(Failure)
    case ready(attachment: JSONValue, prompt: String?, transparent: Bool)

    public static let maxBytes = 10 * 1024 * 1024

    public static func isGeneration(_ tool: ChatToolItem) -> Bool { tool.name == "ImageGeneration" }

    /// The input is the CLI's own and has no schema, so the attachment in it is read by key.
    public static func parse(_ tool: ChatToolItem) -> Self {
        if tool.state == .running { return .generating }
        guard tool.state != .error, let attachment = tool.input["attachment"],
            let id = attachment["id"]?.stringValue, !id.isEmpty,
            attachment["name"]?.stringValue != nil, let mime = attachment["mime"]?.stringValue,
            let size = attachment["size"]?.numberValue, size.isFinite, size >= 0, size.rounded() == size
        else {
            let message = trimmed(tool.output)
            return .failed(tool.state == .error || message != nil ? .provider(message) : .empty)
        }
        if size == 0 { return .failed(.empty) }
        if !mime.hasPrefix("image/") { return .failed(.notImage) }
        if size > Double(maxBytes) { return .failed(.tooLarge) }
        return .ready(
            attachment: attachment, prompt: trimmed(tool.input["revisedPrompt"]?.stringValue),
            transparent: tool.input["transparentBackground"]?.boolValue == true)
    }

    private static func trimmed(_ text: String?) -> String? {
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    public static func aspect(_ attachment: JSONValue) -> Double? {
        guard let width = attachment["width"]?.numberValue, let height = attachment["height"]?.numberValue,
            width.isFinite, height.isFinite, width > 0, height > 0
        else { return nil }
        let ratio = width / height
        return ratio.isFinite ? ratio : nil
    }
}
