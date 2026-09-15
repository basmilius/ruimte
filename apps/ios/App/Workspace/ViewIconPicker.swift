import RuimtePulsar
import SwiftUI

struct ViewIconPicker: View {
    let workspace: MobileWorkspace
    let item: JSONValue
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var emoji = ""
    @State private var saving = false

    // The project protocol accepts this same closed set in contracts/src/project.ts.
    private static let names = [
        "box",
        "boxes",
        "package",
        "layers",
        "code",
        "terminal",
        "cpu",
        "circuit-board",
        "memory-stick",
        "pc-case",
        "laptop",
        "monitor",
        "smartphone",
        "tablet",
        "webcam",
        "printer",
        "hard-drive",
        "usb",
        "database",
        "server",
        "container",
        "network",
        "router",
        "ethernet-port",
        "cable",
        "plug",
        "wifi",
        "radio-tower",
        "satellite-dish",
        "cloud",
        "globe",
        "rocket",
        "zap",
        "flame",
        "sparkles",
        "star",
        "heart",
        "flag",
        "bookmark",
        "folder",
        "file-text",
        "book",
        "puzzle",
        "palette",
        "brush",
        "camera",
        "music",
        "video",
        "gamepad-2",
        "bot",
        "brain",
        "beaker",
        "wrench",
        "hammer",
        "shield",
        "key",
        "compass",
        "map",
        "leaf",
        "coffee",
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    HStack {
                        TextField("Emoji", text: $emoji)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        Button("Use emoji") { save(.object(["kind": .string("emoji"), "value": .string(emoji)])) }
                            .disabled(
                                emoji.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || emoji.utf16.count > 16)
                    }
                    .padding(14).background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
                    Button("Use default icon") { save(nil) }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 52))], spacing: 12) {
                        ForEach(
                            Self.names.filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) },
                            id: \.self
                        ) { name in
                            Button {
                                save(.object(["kind": .string("lucide"), "value": .string(name)]))
                            } label: {
                                LucideIcon(name: name, size: 24)
                                    .frame(maxWidth: .infinity, minHeight: 52)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(
                                MobileSidebarButtonStyle(
                                    selected: item["icon"]?.text("value") == name, cornerRadius: 14)
                            )
                            .accessibilityLabel(name.replacingOccurrences(of: "-", with: " "))
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
            .onAppear { if item["icon"]?.text("kind") == "emoji" { emoji = item["icon"]?.text("value") ?? "" } }
        }.tint(MobileStyle.accent)
    }

    private func save(_ icon: JSONValue?) {
        saving = true
        Task {
            await workspace.updateView(item.stableID) { $0.setting("icon", icon) }
            dismiss()
        }
    }
}
