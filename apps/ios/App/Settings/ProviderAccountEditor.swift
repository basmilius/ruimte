import SwiftUI

struct ProviderAccountEditorTarget: Identifiable {
    let kind: String
    var accountID: String? = nil
    var label = ""
    var enabled = true
    var id: String { accountID ?? "new:\(kind)" }
}

struct ProviderAccountEditor: View {
    @Bindable var model: MachineAgentsModel
    let target: ProviderAccountEditorTarget
    let connected: Bool
    @State private var label: String
    @State private var enabled: Bool
    @Environment(\.dismiss) private var dismiss

    init(model: MachineAgentsModel, target: ProviderAccountEditorTarget, connected: Bool) {
        self.model = model
        self.target = target
        self.connected = connected
        _label = State(initialValue: target.label)
        _enabled = State(initialValue: target.enabled)
    }

    private var supported: Bool {
        target.accountID == nil ? model.canAdd(target.kind) : model.answers(.accountsSave)
    }

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    TextField("Name", text: $label).autocorrectionDisabled()
                        .accessibilityIdentifier("accounts.label")
                    if target.accountID != nil { Toggle("On", isOn: $enabled) }
                } footer: {
                    Text("Up to 80 characters. Clear an existing name to use the account's original name.")
                }
                if target.accountID == nil {
                    Section {
                        Text("The machine creates the account folder. Sign in from its account row after adding it.")
                        if model.chatLogins.contains(target.kind) {
                            Text("This CLI signs in from a chat. Start a chat under the new account to sign in.")
                        }
                    }
                }
                if !connected {
                    Text("Connect to this machine to manage its accounts.")
                } else if !supported {
                    Text("Update this machine to manage accounts from your phone.")
                }
                if let problem = model.state.problem { Text(problem).foregroundStyle(MobileStyle.statusError) }
            }
            .disabled(model.state.busy)
            .navigationTitle(
                target.accountID == nil ? String(localized: "Add account") : String(localized: "Edit account")
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(model.state.busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(
                            !connected || !supported || model.state.busy
                                || (try? MachineAgentsModel.label(label, required: target.accountID == nil)) == nil
                        )
                        .accessibilityIdentifier("accounts.save")
                }
            }
        }
    }

    private func save() async {
        let saved: Bool
        if let id = target.accountID {
            saved = await model.save(
                id: id, kind: target.kind,
                label: label == target.label ? nil : label, enabled: enabled == target.enabled ? nil : enabled)
        } else {
            saved = await model.create(kind: target.kind, label: label)
        }
        if saved { dismiss() }
    }
}
