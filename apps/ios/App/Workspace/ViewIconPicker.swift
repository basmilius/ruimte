import RuimtePulsar
import SwiftUI

struct ViewIconPicker: View {
    let workspace: MobileWorkspace
    let item: ProjectItem
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false

    var body: some View {
        NavigationStack {
            IconChoiceGrid(selected: item.icon, resetTitle: String(localized: "Use default icon")) {
                save($0)
            }
            .disabled(saving)
            .navigationTitle("View icon").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }.tint(MobileStyle.accent)
    }

    private func save(_ name: String?) {
        saving = true
        let icon = name.map { JSONValue.object(["kind": .string("lucide"), "value": .string($0)]) }
        Task {
            await workspace.updateView(item.id) { $0.setting("icon", icon) }
            dismiss()
        }
    }
}

/// The closed set of Lucide marks a view or a project can wear, searchable, with a way back to the default above it.
struct IconChoiceGrid: View {
    let selected: String?
    let resetTitle: String
    let pick: (String?) -> Void
    @State private var query = ""

    private struct IconGroup {
        let label: String
        let names: [String]
    }

    private static let groups = WireVocabulary.projectIconGroups.map { group in
        IconGroup(label: groupLabel(group.id) ?? group.id.capitalized, names: group.names)
    }

    /// The words over a group of icons. The groups, their order and the keywords come from the contracts, so a group
    /// the desktop adds shows under its id until it has a label here.
    static func groupLabel(_ id: String) -> String? {
        switch id {
        case "general": String(localized: "General", comment: "Group of icons")
        case "code": String(localized: "Code", comment: "Group of icons")
        case "ai": String(localized: "AI & agents", comment: "Group of icons")
        case "web": String(localized: "Web & apps", comment: "Group of icons")
        case "infra": String(localized: "Infrastructure", comment: "Group of icons")
        case "data": String(localized: "Data & science", comment: "Group of icons")
        case "hardware": String(localized: "Hardware", comment: "Group of icons")
        case "design": String(localized: "Design & media", comment: "Group of icons")
        case "writing": String(localized: "Writing & learning", comment: "Group of icons")
        case "planning": String(localized: "Planning", comment: "Group of icons")
        case "life": String(localized: "Life & world", comment: "Group of icons")
        default: nil
        }
    }

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
        ScrollView {
            VStack(spacing: 20) {
                Button(resetTitle) { pick(nil) }
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
        .searchable(text: $query, prompt: "Find an icon")
    }

    private func iconButton(_ name: String) -> some View {
        Button {
            pick(name)
        } label: {
            LucideIcon(name: name, size: 24)
                .frame(maxWidth: .infinity, minHeight: 52)
                .contentShape(Rectangle())
        }
        .buttonStyle(MobileSidebarButtonStyle(selected: selected == name, cornerRadius: MobileMetrics.tileRadius))
        .accessibilityLabel(name.replacingOccurrences(of: "-", with: " "))
    }

    private static func matches(_ name: String, _ needle: String) -> Bool {
        name.localizedCaseInsensitiveContains(needle)
            || name.replacingOccurrences(of: "-", with: " ").localizedCaseInsensitiveContains(needle)
            || WireVocabulary.projectIconKeywords[name, default: []].contains { $0.localizedCaseInsensitiveContains(needle) }
    }
}
