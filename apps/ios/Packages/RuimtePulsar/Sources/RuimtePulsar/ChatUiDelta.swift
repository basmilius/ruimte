import Foundation

public enum ChatUiDelta {
    public static func apply(_ event: JSONValue, to value: JSONValue) -> JSONValue {
        guard var item = value.objectValue else { return value }
        let text = event["text"]?.stringValue ?? ""
        if item["kind"]?.stringValue == "tool" {
            var progress = item["progress"]?.objectValue ?? [:]
            progress["output"] = .string((progress["output"]?.stringValue ?? "") + text)
            item["progress"] = .object(progress)
        } else {
            let updated = (item["text"]?.stringValue ?? "") + text
            item["text"] = .string(updated)
            let assistant = item["kind"]?.stringValue == "assistant"
            // Daemon offsets use JavaScript UTF-16 units; a delayed preview must not replace a newer one.
            if assistant, item["streaming"]?.boolValue == true, let blocks = event["ui"],
                event["textLength"]?.numberValue == Double(updated.utf16.count)
            {
                item["ui"] = blocks
            }
            if assistant, let queries = event["uiQueries"] { item["uiQueries"] = queries }
        }
        return .object(item)
    }
}
