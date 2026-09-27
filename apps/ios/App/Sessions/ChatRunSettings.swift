import RuimtePulsar
import SwiftUI

struct ChatRunSettings: View {
    @Bindable var model: ChatModel
    @Binding var presented: Bool

    private var selection: JSONValue { model.info["selection"] ?? .null }
    private var selected: JSONValue { model.models.first { $0["slug"] == selection["model"] } ?? .null }
    private var mode: String { model.info.text("runtimeMode", fallback: "supervised") }
    private var account: ProviderAccountEntry? {
        let kind = model.info.text("provider")
        guard let accounts = model.accounts, accounts.hasChoice(kind) else { return nil }
        let id = model.info["account"]?.stringValue ?? kind
        return accounts.entries.first { $0.kind == kind && $0.id == id }
    }
    private var label: String {
        let slug = selection.text("model")
        return slug.isEmpty ? "Choose model" : ModelName.of(slug, in: model.models)
    }

    var body: some View {
        Button {
            presented = true
        } label: {
            HStack(spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).lineLimit(1).truncationMode(.middle)
                    if let account {
                        HStack(spacing: 4) {
                            AccountDot(color: account.color, size: 6)
                            Text(account.name(provider: usageProviderName(model.info.text("provider"))))
                                .font(.caption2).foregroundStyle(MobileStyle.muted).lineLimit(1)
                        }
                    }
                }
                Image(lucide: mode == "full-access" ? "shield-off" : "chevron-down", size: 13)
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(MobileStyle.text)
            .padding(.horizontal, 12).frame(minHeight: 36)
            .background(MobileStyle.inset.opacity(0.65), in: Capsule())
            .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(ChatComposerButtonStyle())
        .accessibilityLabel("Run settings, \(label)")
        .accessibilityValue(
            [account?.name(provider: usageProviderName(model.info.text("provider"))), Self.modeName(mode)].compactMap {
                $0
            }.joined(separator: ", ")
        )
        .mobileSheet(isPresented: $presented) { settings }
    }

    private var settings: some View {
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
                            set: { slug in
                                updateSelection(.object(["model": .string(slug), "options": .object([:])]))
                            })
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
                            get: { mode },
                            set: { value in
                                Task {
                                    if await model.configure(["runtimeMode": .string(value)]) {
                                        ChatPreferences.shared.rememberRuntimeMode(value)
                                    }
                                }
                            })
                    ) {
                        ForEach(["supervised", "auto-accept-edits", "auto", "full-access"], id: \.self) { value in
                            Text(Self.modeName(value)).tag(value)
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
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { presented = false } } }
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

    private func updateOption(_ id: String, value: JSONValue) {
        var values = selection.objectValue ?? [:]
        var options = values["options"]?.objectValue ?? [:]
        options[id] = value
        values["options"] = .object(options)
        updateSelection(.object(values))
    }

    private func updateSelection(_ selection: JSONValue) {
        Task {
            if await model.configure(["selection": selection]) {
                ChatPreferences.shared.rememberSelection(selection, provider: model.info.text("provider"))
            }
        }
    }

    static func modeName(_ value: String) -> String {
        switch value {
        case "auto-accept-edits": "Accept edits"
        case "auto": "Automatic"
        case "full-access": "Full access"
        default: "Ask for approval"
        }
    }
}
