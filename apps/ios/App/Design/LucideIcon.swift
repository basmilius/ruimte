import LucideSwift
import RuimtePulsar
import SwiftUI

struct LucideIcon: View {
    let name: String
    var size: CGFloat = 20

    var body: some View {
        (Self.icon(named: name) ?? .circleQuestionMark).shape
            .stroke(style: StrokeStyle(lineWidth: size / 12, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    static func icon(named name: String) -> LucideIconName? {
        if name == "package" { return .packageIcon }
        let words = name.split(separator: "-")
        let key =
            (words.first.map(String.init) ?? "")
            + words.dropFirst().map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined()
        return LucideIconName(rawValue: key)
    }
}

struct WorkspaceViewIcon: View {
    let item: JSONValue
    var size: CGFloat = 20

    var body: some View {
        Group {
            if item.text("kind") != "unknown", let icon = item["icon"], icon.text("kind") == "emoji" {
                Text(icon.text("value")).font(.system(size: size - 2))
                    .frame(width: size, height: size)
            } else {
                LucideIcon(name: Self.name(for: item), size: size)
            }
        }.accessibilityHidden(true)
    }

    static func name(for item: JSONValue) -> String {
        if item.text("kind") != "unknown", let icon = item["icon"], icon.text("kind") == "lucide" {
            return icon.text("value")
        }
        // Match the fallback marks in the desktop client's project/ViewGlyph.tsx.
        switch item.text("kind") {
        case "canvas": return "frame"
        case "chat": return "message-square"
        case "terminal": return "terminal"
        case "browser": return "globe"
        case "drawing": return "pen-tool"
        case "diagram": return "workflow"
        case "file": return "file-text"
        case "note": return "sticky-note"
        case "group": return "layout-grid"
        default: return "circle-question-mark"
        }
    }
}
