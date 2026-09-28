import RuimtePulsar
import SwiftUI

/// The permission modes as the desktop names them, from the one that asks most to the one that never asks.
enum ChatRuntimeMode {
    static let all = ["supervised", "auto-accept-edits", "auto", "full-access"]

    static func label(_ mode: String) -> String {
        switch mode {
        case "auto-accept-edits": "Auto-accept edits"
        case "auto": "Auto"
        case "full-access": "Full access"
        default: "Supervised"
        }
    }

    static func short(_ mode: String) -> String {
        switch mode {
        case "auto-accept-edits": "Edits"
        case "auto": "Auto"
        case "full-access": "Full access"
        default: "Ask"
        }
    }

    static func hint(_ mode: String) -> String {
        switch mode {
        case "auto-accept-edits": "File edits go through, commands still ask"
        case "auto": "The agent reviews routine actions itself"
        case "full-access": "Never asks for approval"
        default: "Asks before commands and file changes"
        }
    }

    static func icon(_ mode: String) -> String {
        switch mode {
        case "auto-accept-edits": "file-pen"
        case "auto": "shield"
        case "full-access": "shield-alert"
        default: "hand"
        }
    }
}

/// Everything that decides how the next turn runs, as one form: what `/model` opens, and what the model pill leads to
/// for the account, the model's own options and the context.
struct ChatRunSettings: View {
    @Bindable var model: ChatModel
    @Environment(\.dismiss) private var dismiss

    private var selection: JSONValue { model.selection }
    private var selected: JSONValue { model.selectedModel }
    private var mode: String { model.runtimeMode }
    private var label: String {
        let slug = selection.text("model")
        return slug.isEmpty ? "Choose model" : ModelName.of(slug, in: model.models)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error = model.settingsProblem {
                    Section { Text(error).foregroundStyle(MobileStyle.statusError) }
                }
                Section("Model") {
                    Picker(
                        "Model",
                        selection: Binding(
                            get: { selection.text("model") },
                            set: { model.chooseModel($0) })
                    ) {
                        if model.models.isEmpty { Text(label).tag(selection.text("model")) }
                        ForEach(Array(model.models.enumerated()), id: \.offset) { _, option in
                            Text(option.text("name", fallback: ModelName.fromSlug(option.text("slug")))).tag(
                                option.text("slug"))
                        }
                    }
                    ForEach(Array(selected.list("options").enumerated()), id: \.offset) { _, option in optionRow(option)
                    }
                }
                if let accounts = model.accounts, accounts.hasChoice(model.info.text("provider")) {
                    Section("Account") {
                        let kind = model.info.text("provider")
                        let current = model.info["account"]?.stringValue ?? kind
                        let started = ProviderAccountList.chatStarted(model.info)
                        ForEach(accounts.offered(kind, current: current)) { account in
                            let locked = started && !accounts.canContinue(kind, from: current, to: account.id)
                            Button {
                                Task { _ = await model.configure(["account": .string(account.id)]) }
                            } label: {
                                HStack(spacing: 10) {
                                    AccountDot(color: account.color, size: 8)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(account.name(provider: usageProviderName(kind)))
                                        if locked {
                                            Text("Fork the conversation to use this account.").font(.caption)
                                                .foregroundStyle(MobileStyle.muted)
                                        }
                                    }
                                    Spacer()
                                    if account.id == current { Image(lucide: "check", size: 18) }
                                }
                            }.disabled(locked || account.id == current)
                        }
                    }
                }
                Section {
                    Picker(
                        "Permissions",
                        selection: Binding(
                            get: { mode }, set: { model.chooseMode($0) })
                    ) {
                        ForEach(ChatRuntimeMode.all, id: \.self) { value in
                            Text(ChatRuntimeMode.label(value)).tag(value)
                        }
                    }
                } header: {
                    Text("Permissions")
                } footer: {
                    Text(
                        mode == "full-access"
                            ? "The agent can act without asking for approval."
                            : "These permissions apply to the agent's next actions.")
                }
                if let usage = model.info["usage"], let window = usage["contextWindow"]?.numberValue, window > 0 {
                    Section("Context") {
                        let used = usage["contextTokens"]?.numberValue ?? 0
                        LabeledContent("Used", value: "\(Int(used).formatted()) / \(Int(window).formatted()) tokens")
                        ProgressView(value: min(1, max(0, used / window)))
                        if model.capabilities.text("compaction") != "none" {
                            Button("Compact conversation") {
                                Task {
                                    do {
                                        _ = try await model.client.request("chat.compact", payload: model.target())
                                        model.settingsProblem = nil
                                    } catch { model.settingsProblem = error.localizedDescription }
                                }
                            }.disabled(model.working || used == 0)
                        }
                    }
                }
            }
            .disabled(!model.connected || model.loading || model.configuring || model.sending)
            .navigationTitle("Run settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    @ViewBuilder private func optionRow(_ option: JSONValue) -> some View {
        let id = option.text("id")
        let title = option.text("label", fallback: id)
        if option.text("type") == "boolean" {
            Toggle(
                isOn: Binding(
                    get: { selection["options"]?[id]?.boolValue ?? option["defaultValue"]?.boolValue ?? false },
                    set: { updateOption(id, value: .bool($0)) })
            ) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                    if !option.text("description").isEmpty {
                        Text(option.text("description")).font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
            }
        } else {
            Picker(
                title,
                selection: Binding(
                    get: { selection["options"]?[id]?.stringValue ?? option.text("defaultChoice") },
                    set: { updateOption(id, value: .string($0)) })
            ) {
                ForEach(Array(option.list("choices").enumerated()), id: \.offset) { _, choice in
                    Text(choice.text("label")).tag(choice.text("id"))
                }
            }
        }
    }

    private func updateOption(_ id: String, value: JSONValue) { model.chooseOption(id, value: value) }

    private func updateSelection(_ selection: JSONValue) { model.chooseSelection(selection) }
}

extension ChatModel {
    var selection: JSONValue { info["selection"] ?? .null }
    var runtimeMode: String { info.text("runtimeMode", fallback: "supervised") }
    var canConfigure: Bool { connected && !loading && !configuring && !sending }

    /// The model the chat runs on, with its own options.
    var selectedModel: JSONValue { models.first { $0["slug"] == selection["model"] } ?? .null }

    func chooseModel(_ slug: String) {
        chooseSelection(.object(["model": .string(slug), "options": .object([:])]))
    }

    func chooseOption(_ id: String, value: JSONValue) {
        var values = selection.objectValue ?? [:]
        var options = values["options"]?.objectValue ?? [:]
        options[id] = value
        values["options"] = .object(options)
        chooseSelection(.object(values))
    }

    func chooseSelection(_ selection: JSONValue) {
        Task {
            if await configure(["selection": selection]) {
                ChatPreferences.shared.rememberSelection(selection, provider: info.text("provider"))
            }
        }
    }

    func chooseMode(_ mode: String) {
        Task {
            if await configure(["runtimeMode": .string(mode)]) {
                ChatPreferences.shared.rememberRuntimeMode(mode)
            }
        }
    }
}
