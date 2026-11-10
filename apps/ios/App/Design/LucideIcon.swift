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

    /// `ContentUnavailableView.search` with the Lucide magnifier in place of the system's.
    @MainActor static func search(for text: String) -> Self {
        Self(
            String(localized: "No results for \"\(text)\""), lucideIcon: "search",
            description: Text("Check the spelling or try a new search."))
    }

    /// For a page whose machine left the account while it was open.
    @MainActor static var machineUnavailable: Self {
        Self(
            String(localized: "Machine unavailable"), lucideIcon: "triangle-alert",
            description: Text("This machine is no longer connected to this device."))
    }
}

struct WorkspaceViewIcon: View {
    let name: String
    var size: CGFloat = 20

    init(item: JSONValue, size: CGFloat = 20) {
        name = Self.name(for: item)
        self.size = size
    }

    init(item: ProjectItem, size: CGFloat = 20) {
        name = Self.name(kind: item.kind, chosen: item.icon)
        self.size = size
    }

    var body: some View {
        LucideIcon(name: name, size: size).accessibilityHidden(true)
    }

    nonisolated static func name(for item: JSONValue) -> String {
        let icon = item["icon"].flatMap { $0.text("kind") == "lucide" ? $0.text("value") : nil }
        return name(kind: item.text("kind"), chosen: icon)
    }

    nonisolated static func name(for view: StoredView) -> String {
        name(kind: view.kind, chosen: view.icon.flatMap { $0.kind == "lucide" ? $0.value : nil })
    }

    nonisolated static func name(for node: StoredNode) -> String { name(kind: node.kind.rawValue, chosen: nil) }

    nonisolated static func name(kind: String, chosen: String?) -> String {
        if kind != "unknown", let chosen { return chosen }
        return ProjectKinds.row(kind)?.icon ?? "circle-question-mark"
    }
}
