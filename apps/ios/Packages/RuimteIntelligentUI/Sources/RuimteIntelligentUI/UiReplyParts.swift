import Foundation
import RuimtePulsar

public enum UiReplyPart: Equatable, Sendable {
    case text(String)
    case block(JSONValue)
}

public enum UiReplyParts {
    /// The text a block was compiled from, by the daemon's UTF-16 offsets; nil when they do not fit the text.
    public static func source(text: String, block: JSONValue) -> String? {
        guard let start = block["start"]?.numberValue, let end = block["end"]?.numberValue,
            start.isFinite, end.isFinite, start.rounded() == start, end.rounded() == end, start >= 0, end >= start,
            end <= Double(text.utf16.count),
            let range = Range(NSRange(location: Int(start), length: Int(end - start)), in: text)
        else { return nil }
        return String(text[range])
    }

    public static func split(text: String, blocks: [JSONValue], streaming: Bool = false) -> [UiReplyPart] {
        var parts: [UiReplyPart] = []
        var position = 0
        var identities: Set<String> = []
        let length = text.utf16.count
        let units = text as NSString
        func scalarBoundary(_ offset: Int) -> Bool {
            guard offset > 0, offset < length else { return true }
            return !(0xDC00...0xDFFF).contains(units.character(at: offset))
                || !(0xD800...0xDBFF).contains(units.character(at: offset - 1))
        }
        for block in blocks.sorted(by: { ($0["start"]?.numberValue ?? .infinity) < ($1["start"]?.numberValue ?? .infinity) }).prefix(16) {
            guard let startValue = block["start"]?.numberValue, let endValue = block["end"]?.numberValue,
                startValue.isFinite, endValue.isFinite, startValue.rounded() == startValue, endValue.rounded() == endValue,
                startValue >= Double(position), endValue >= startValue, endValue <= Double(length),
                let identity = block["id"]?.stringValue, !identity.isEmpty, identities.insert(identity).inserted
            else { continue }
            let start = Int(startValue)
            let end = Int(endValue)
            guard scalarBoundary(start), scalarBoundary(end),
                let preceding = Range(NSRange(location: position, length: start - position), in: text),
                Range(NSRange(location: start, length: end - start), in: text) != nil
            else { continue }
            if start > position { parts.append(.text(String(text[preceding]))) }
            parts.append(.block(block))
            position = streaming && block["complete"]?.boolValue != true ? length : end
        }
        if position < length, let remaining = Range(NSRange(location: position, length: length - position), in: text) {
            parts.append(.text(String(text[remaining])))
        }
        return parts
    }
}
