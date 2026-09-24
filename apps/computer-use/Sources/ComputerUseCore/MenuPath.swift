import Foundation

public enum MenuPath {
    /// `"File > Save As"` as its steps; empty steps are dropped.
    public static func steps(_ path: String) -> [String] {
        path.split(separator: ">").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !normalize($0).isEmpty }
    }

    /// Matches titles without case and without a trailing ellipsis, so "File > Save As" finds "Save As…".
    public static func normalize(_ title: String) -> String {
        var text = (VisibleText.clean(title) ?? "").lowercased()
        for suffix in ["…", "..."] where text.hasSuffix(suffix) {
            text = String(text.dropLast(suffix.count))
        }
        return text.trimmingCharacters(in: .whitespaces)
    }

    public static func matches(_ title: String, _ step: String) -> Bool {
        normalize(title) == normalize(step)
    }
}

public enum VisibleText {
    /// Drops invisible format characters such as soft hyphens, which would break matching a label an agent reads back.
    public static func clean(_ text: String?) -> String? {
        guard let text else {
            return nil
        }
        let visible = String(String.UnicodeScalarView(text.unicodeScalars.filter { $0.properties.generalCategory != .format }))
        let trimmed = visible.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
