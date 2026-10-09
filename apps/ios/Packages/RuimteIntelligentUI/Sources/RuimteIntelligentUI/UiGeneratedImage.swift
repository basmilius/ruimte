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

    public static func isGeneration(_ tool: JSONValue) -> Bool {
        tool["kind"] == .string("tool") && tool["name"] == .string("ImageGeneration")
    }

    public static func parse(_ tool: JSONValue) -> Self {
        if tool["state"] == .string("running") { return .generating }
        let message = tool["output"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard tool["state"] != .string("error"), let attachment = tool["input"]?["attachment"],
            let id = attachment["id"]?.stringValue, !id.isEmpty,
            attachment["name"]?.stringValue != nil, let mime = attachment["mime"]?.stringValue,
            let size = attachment["size"]?.numberValue, size.isFinite, size >= 0, size.rounded() == size
        else { return .failed(tool["state"] == .string("error") || message?.isEmpty == false ? .provider(message?.isEmpty == false ? message : nil) : .empty) }
        if size == 0 { return .failed(.empty) }
        if !mime.hasPrefix("image/") { return .failed(.notImage) }
        if size > Double(maxBytes) { return .failed(.tooLarge) }
        let prompt = tool["input"]?["revisedPrompt"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        return .ready(attachment: attachment, prompt: prompt?.isEmpty == false ? prompt : nil, transparent: tool["input"]?["transparentBackground"]?.boolValue == true)
    }

    public static func aspect(_ attachment: JSONValue) -> Double? {
        guard let width = attachment["width"]?.numberValue, let height = attachment["height"]?.numberValue,
            width.isFinite, height.isFinite, width > 0, height > 0
        else { return nil }
        let ratio = width / height
        return ratio.isFinite ? ratio : nil
    }
}
