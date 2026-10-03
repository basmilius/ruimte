import RuimtePulsar
import SwiftUI

/// What View settings writes into a view.
enum ViewSettings {
    /// An address as a person types it, with `https://` when it names no scheme; nil for anything that is no web
    /// address.
    static func address(_ typed: String) -> String? {
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let full = text.contains("://") ? text : "https://" + text
        guard let url = URL(string: full), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil
        else { return nil }
        return full
    }

    /// The view with a new name and, for a browser, a new address. An empty name leaves the name as it was, since
    /// half a name is not a name.
    static func applying(name: String, address: String?, to view: JSONValue) -> JSONValue {
        var changed = view
        let typed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty && typed != view.text("name") {
            changed = changed.setting("name", .string(typed)).setting("titleSource", .string("user"))
        }
        if view.text("kind") == "browser", let address {
            changed = changed.setting("url", .string(address))
            // A browser nobody named takes the name of what it shows, as the desktop names one.
            if changed.text("titleSource") != "user" { changed = changed.setting("name", .string(address)) }
        }
        return changed
    }
}

/// A view's name and mark, and what a browser shows, as the desktop's view settings hold them.
struct ViewSettingsSheet: View {
    let workspace: MobileWorkspace
    let item: JSONValue
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var address: String
    @State private var saving = false

    init(workspace: MobileWorkspace, item: JSONValue) {
        self.workspace = workspace
        self.item = item
        _name = State(initialValue: item.text("name"))
        _address = State(initialValue: item.text("url"))
    }

    private var current: JSONValue { workspace.views.first { $0.stableID == item.stableID } ?? item }
    private var isBrowser: Bool { item.text("kind") == "browser" }
    private var addressProblem: Bool { isBrowser && !address.isEmpty && ViewSettings.address(address) == nil }

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    TextField("Name", text: $name).submitLabel(.done).onSubmit { save() }
                } footer: {
                    Text("Leave it as it is to keep the name a session gives it.")
                }
                if isBrowser {
                    Section {
                        TextField("https://", text: $address)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .submitLabel(.done).onSubmit { save() }
                    } header: {
                        Text("Address")
                    } footer: {
                        if addressProblem { Text("Enter an HTTP or HTTPS address.") }
                    }
                }
                if item.text("kind") == "file" {
                    Section("File") {
                        Text(item.text("path")).font(.callout.monospaced()).foregroundStyle(MobileStyle.muted)
                            .textSelection(.enabled)
                    }
                }
                Section {
                    NavigationLink {
                        IconChoiceGrid(selected: current["icon"]?.text("value"), resetTitle: "Use default icon") {
                            name in
                            let icon = name.map { JSONValue.object(["kind": .string("lucide"), "value": .string($0)]) }
                            Task { await workspace.updateView(item.stableID) { $0.setting("icon", icon) } }
                        }
                        .navigationTitle("Icon").navigationBarTitleDisplayMode(.inline)
                    } label: {
                        HStack {
                            Text("Icon")
                            Spacer()
                            WorkspaceViewIcon(item: current, size: 16).foregroundStyle(MobileStyle.muted)
                        }
                    }
                }
                if let problem = workspace.problem { Text(problem).foregroundStyle(MobileStyle.statusError) }
            }
            .disabled(saving)
            .navigationTitle("View settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) { save() }.disabled(addressProblem)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        guard !addressProblem else { return }
        saving = true
        Task {
            defer { saving = false }
            let address = ViewSettings.address(address)
            await workspace.updateView(item.stableID) { ViewSettings.applying(name: name, address: address, to: $0) }
            if workspace.problem == nil { dismiss() }
        }
    }
}
