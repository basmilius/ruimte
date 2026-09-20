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

    private static let names: [String: LucideIconName] = {
        var names = Dictionary(
            LucideIconName.allCases.map { ($0.rawValue.lowercased(), $0) }, uniquingKeysWith: { first, _ in first })
        names["package"] = .packageIcon
        return names
    }()

    static func icon(named name: String) -> LucideIconName? {
        names[name.replacingOccurrences(of: "-", with: "").lowercased()]
    }

    @MainActor private static var images: [String: Image] = [:]

    @MainActor static func image(named name: String, size: CGFloat) -> Image {
        let key = "\(name):\(size)"
        if let image = images[key] { return image }
        let image = Image(
            lucide: icon(named: name) ?? .circleQuestionMark,
            size: CGSize(width: size, height: size), strokeWidth: size / 12)
        if images.count >= 256, let cachedKey = images.keys.first { images.removeValue(forKey: cachedKey) }
        images[key] = image
        return image
    }
}

extension Image {
    @MainActor init(lucide name: String, size: CGFloat = 20) {
        self = LucideIcon.image(named: name, size: size)
    }
}

extension Label where Title == Text, Icon == Image {
    @MainActor init(_ title: String, lucideIcon name: String, iconSize: CGFloat = 20) {
        self.init {
            Text(title)
        } icon: {
            Image(lucide: name, size: iconSize)
        }
    }
}

extension Button where Label == SwiftUI.Label<Text, Image> {
    @MainActor init(_ title: String, lucideIcon name: String, role: ButtonRole? = nil, action: @escaping () -> Void) {
        self.init(role: role, action: action) { SwiftUI.Label(title, lucideIcon: name) }
    }
}

extension ContentUnavailableView where Label == SwiftUI.Label<Text, Image>, Description == Text?, Actions == EmptyView {
    @MainActor init(_ title: String, lucideIcon name: String, description: Text? = nil) {
        self.init {
            SwiftUI.Label(title, lucideIcon: name, iconSize: 48)
        } description: {
            description
        }
    }
}

struct WorkspaceViewIcon: View {
    let item: JSONValue
    var size: CGFloat = 20

    var body: some View {
        LucideIcon(name: Self.name(for: item), size: size).accessibilityHidden(true)
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
        case "device": return "smartphone"
        case "separator": return "minus"
        case "subheader": return "heading"
        case "drawing": return "pen-tool"
        case "diagram": return "workflow"
        case "file": return "file-text"
        case "note": return "sticky-note"
        case "group": return "layout-grid"
        default: return "circle-question-mark"
        }
    }
}
