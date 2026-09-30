import RuimtePulsar
import SwiftUI

struct ViewIconPicker: View {
    let workspace: MobileWorkspace
    let item: JSONValue
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var saving = false

    private struct IconGroup {
        let label: String
        let names: [String]
    }

    // The project protocol accepts this same closed set in contracts/src/project.ts; the groups, their
    // order and the keywords follow apps/client/src/project/project-icons.ts.
    private static let groups = [
        IconGroup(
            label: "General",
            names: [
                "folder", "box", "boxes", "package", "layers", "puzzle", "star", "heart", "flag", "bookmark", "pin",
                "target", "lightbulb", "archive", "inbox", "house", "briefcase", "sparkles", "zap", "flame", "rocket",
            ]),
        IconGroup(
            label: "Code",
            names: [
                "code", "code-xml", "braces", "terminal", "square-terminal", "file-code", "binary", "regex", "variable",
                "blocks", "component", "git-branch", "git-merge", "git-pull-request", "git-fork", "bug",
                "test-tube-diagonal", "flask-conical", "beaker", "wrench", "hammer", "workflow", "webhook",
            ]),
        IconGroup(
            label: "AI & agents",
            names: [
                "bot", "bot-message-square", "brain", "brain-circuit", "wand-sparkles", "messages-square", "scan-eye",
                "audio-waveform",
            ]),
        IconGroup(
            label: "Web & apps",
            names: [
                "globe", "app-window", "layout-dashboard", "layout-template", "panels-top-left", "mouse-pointer-click",
                "smartphone", "tablet", "shopping-cart", "store", "mail",
            ]),
        IconGroup(
            label: "Infrastructure",
            names: [
                "server", "server-cog", "database", "container", "cloud", "cloud-cog", "network", "router", "gauge",
                "activity", "scroll-text", "bell", "shield", "lock", "key", "fingerprint-pattern",
            ]),
        IconGroup(
            label: "Data & science",
            names: [
                "chart-line", "chart-column", "chart-pie", "table", "sheet", "calculator", "sigma", "atom", "dna",
                "telescope", "orbit",
            ]),
        IconGroup(
            label: "Hardware",
            names: [
                "cpu", "microchip", "circuit-board", "memory-stick", "pc-case", "laptop", "monitor", "keyboard",
                "mouse", "webcam", "printer", "hard-drive", "usb", "headphones", "watch", "battery", "bluetooth",
                "thermometer", "ethernet-port", "cable", "plug", "wifi", "radio-tower", "satellite-dish",
            ]),
        IconGroup(
            label: "Design & media",
            names: [
                "palette", "brush", "pen-tool", "pencil-ruler", "shapes", "frame", "swatch-book", "type", "image",
                "camera", "film", "clapperboard", "video", "music", "mic", "gamepad-2",
            ]),
        IconGroup(
            label: "Writing & learning",
            names: [
                "file-text", "book", "notebook", "notebook-pen", "library-big", "newspaper", "graduation-cap",
                "languages", "quote", "presentation", "megaphone",
            ]),
        IconGroup(
            label: "Planning",
            names: [
                "list-todo", "square-kanban", "clipboard-list", "calendar", "milestone", "trophy", "hourglass", "timer",
                "users", "handshake", "wallet", "compass", "map",
            ]),
        IconGroup(
            label: "Life & world",
            names: [
                "leaf", "sprout", "trees", "mountain", "sun", "moon", "plane", "ship", "anchor", "life-buoy", "coffee",
                "pizza", "gift", "dumbbell", "bike", "paw-print",
            ]),
    ]

    private static let keywords: [String: [String]] = [
        "house": ["home", "smart home"],
        "git-branch": ["version"],
        "git-pull-request": ["pr", "review"],
        "bug": ["debug", "issue"],
        "test-tube-diagonal": ["test"],
        "flask-conical": ["test", "experiment"],
        "workflow": ["pipeline", "ci"],
        "webhook": ["api"],
        "bot": ["agent", "ai", "claude", "codex"],
        "bot-message-square": ["chat", "agent"],
        "brain": ["ai", "model"],
        "wand-sparkles": ["magic", "generate"],
        "messages-square": ["chat"],
        "audio-waveform": ["voice", "speech"],
        "app-window": ["desktop", "electron"],
        "layout-dashboard": ["admin"],
        "panels-top-left": ["website"],
        "smartphone": ["ios", "mobile"],
        "shopping-cart": ["shop", "ecommerce"],
        "store": ["shop"],
        "mail": ["email", "newsletter"],
        "container": ["docker", "kubernetes"],
        "gauge": ["performance"],
        "activity": ["monitoring"],
        "scroll-text": ["logs"],
        "fingerprint-pattern": ["auth", "identity"],
        "sheet": ["spreadsheet"],
        "dna": ["bio"],
        "microchip": ["embedded", "firmware"],
        "thermometer": ["sensor"],
        "pen-tool": ["vector"],
        "image": ["photo"],
        "gamepad-2": ["game"],
        "library-big": ["docs", "documentation"],
        "graduation-cap": ["course", "school"],
        "languages": ["i18n", "translation"],
        "presentation": ["slides"],
        "list-todo": ["tasks", "checklist"],
        "square-kanban": ["board"],
        "users": ["team"],
        "wallet": ["finance", "money"],
    ]

    private var shownGroups: [IconGroup] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        if needle.isEmpty { return Self.groups }
        return Self.groups.compactMap { group in
            if group.label.localizedCaseInsensitiveContains(needle) { return group }
            let names = group.names.filter { Self.matches($0, needle) }
            return names.isEmpty ? nil : IconGroup(label: group.label, names: names)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Button("Use default icon") { save(nil) }
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 52))], spacing: 12, pinnedViews: [.sectionHeaders]
                    ) {
                        ForEach(shownGroups, id: \.label) { group in
                            Section {
                                ForEach(group.names, id: \.self) { name in iconButton(name) }
                            } header: {
                                Text(group.label)
                                    .font(.footnote.weight(.semibold)).foregroundStyle(MobileStyle.muted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 6)
                                    .background(MobileStyle.surface)
                            }
                        }
                    }
                }.padding()
            }
            .disabled(saving)
            .searchable(text: $query, prompt: "Find an icon")
            .navigationTitle("View icon").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }.tint(MobileStyle.accent)
    }

    private func iconButton(_ name: String) -> some View {
        Button {
            save(.object(["kind": .string("lucide"), "value": .string(name)]))
        } label: {
            LucideIcon(name: name, size: 24)
                .frame(maxWidth: .infinity, minHeight: 52)
                .contentShape(Rectangle())
        }
        .buttonStyle(MobileSidebarButtonStyle(selected: item["icon"]?.text("value") == name, cornerRadius: 14))
        .accessibilityLabel(name.replacingOccurrences(of: "-", with: " "))
    }

    private static func matches(_ name: String, _ needle: String) -> Bool {
        name.localizedCaseInsensitiveContains(needle)
            || name.replacingOccurrences(of: "-", with: " ").localizedCaseInsensitiveContains(needle)
            || keywords[name, default: []].contains { $0.localizedCaseInsensitiveContains(needle) }
    }

    private func save(_ icon: JSONValue?) {
        saving = true
        Task {
            await workspace.updateView(item.stableID) { $0.setting("icon", icon) }
            dismiss()
        }
    }
}
