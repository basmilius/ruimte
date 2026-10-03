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

/// What a chat's context holds, as `context-usage.ts` in `@ruimte/agents-react` reads `info.usage`.
struct ChatContextUsage: Equatable {
    enum Part: String, CaseIterable {
        case toolOutput, filesRead, conversation, system

        var label: String {
            switch self {
            case .toolOutput: "Tool output"
            case .filesRead: "Files read"
            case .conversation: "Conversation"
            case .system: "System"
            }
        }
    }

    struct Segment: Equatable {
        let part: Part
        let tokens: Double
        /// Of the window, so the segments together fill the bar as far as the context is full.
        let fraction: Double
    }

    let used: Double
    let window: Double?

    /// The id of the model option that sets the window's size.
    static let windowOption = "contextWindow"

    init?(_ usage: JSONValue?) {
        guard let usage, let used = usage["contextTokens"]?.numberValue else { return nil }
        self.used = used
        window = usage["contextWindow"]?.numberValue.flatMap { $0 > 0 ? $0 : nil }
        breakdown = usage["breakdown"]
    }

    private let breakdown: JSONValue?

    var fraction: Double { window.map { min(1, used / $0) } ?? 0 }

    /// Nil from a machine that does not estimate, which draws the plain bar.
    var segments: [Segment]? {
        guard let breakdown, breakdown != .null, used > 0 else { return nil }
        let whole = max(window ?? 0, used)
        return Part.allCases.map { part in
            let tokens = breakdown[part.rawValue]?.numberValue ?? 0
            return Segment(part: part, tokens: tokens, fraction: tokens / whole)
        }
    }

    /// "950", "172K", "1M" or "1.2M".
    static func tokens(_ value: Double) -> String {
        if value < 1000 { return "\(Int(value))" }
        if value < 1_000_000 { return "\(Int((value / 1000).rounded()))K" }
        return (value / 1_000_000).formatted(.number.precision(.fractionLength(0...1))) + "M"
    }
}

/// Everything that decides how the next turn runs: the account the chat runs on, its context with the breakdown and
/// Compact now, and the model, its options and the permissions. What `/model` and a long press on the model open.
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
    private var windowOption: JSONValue? {
        selected.list("options").first { $0.text("id") == ChatContextUsage.windowOption && $0.text("type") == "select" }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error = model.settingsProblem {
                    Section { Text(error).foregroundStyle(MobileStyle.statusError) }
                }
                if let accounts = model.accounts, accounts.hasChoice(model.info.text("provider")) {
                    accountSection(accounts)
                }
                if let usage = ChatContextUsage(model.info["usage"]) {
                    contextSection(usage)
                }
                Section {
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
                    ForEach(
                        Array(
                            selected.list("options").filter { $0.text("id") != ChatContextUsage.windowOption }
                                .enumerated()), id: \.offset
                    ) { _, option in optionRow(option) }
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
                    Text("Model, effort, permissions")
                } footer: {
                    Text(
                        mode == "full-access"
                            ? "The agent can act without asking for approval."
                            : "These permissions apply to the agent's next actions.")
                }
            }
            .disabled(!model.connected || model.loading || model.configuring || model.sending)
            .navigationTitle("Run settings")
            .navigationSubtitle("This chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func accountSection(_ accounts: ProviderAccountList) -> some View {
        let kind = model.info.text("provider")
        let current = model.info["account"]?.stringValue ?? kind
        let started = ProviderAccountList.chatStarted(model.info)
        return Section {
            ForEach(accounts.offered(kind, current: current)) { account in
                let locked = started && !accounts.canContinue(kind, from: current, to: account.id)
                Button {
                    model.chooseAccount(account.id)
                } label: {
                    HStack(spacing: 10) {
                        AccountDot(color: account.color, size: 8)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(account.name(provider: usageProviderName(kind))).foregroundStyle(MobileStyle.text)
                            if locked {
                                Text("Fork the conversation to use this account.").font(.caption)
                                    .foregroundStyle(MobileStyle.muted)
                            }
                        }
                        Spacer()
                        if let window = ProviderAccountList.sessionWindow(model.limits, account: account.id) {
                            Text(ChatLimits.sessionLine(window))
                                .font(.caption).monospacedDigit()
                                .foregroundStyle(ChatRunSettings.tone(window.used))
                        }
                        if account.id == current { Image(lucide: "check", size: 16) }
                    }
                }
                .disabled(locked || account.id == current)
            }
        } header: {
            Text("Account")
        } footer: {
            Text("A new chat of \(usageProviderName(kind)) on this machine starts under the account you pick.")
        }
        .task(id: model.connected) { await model.readLimits() }
    }

    private func contextSection(_ usage: ChatContextUsage) -> some View {
        Section("Context") {
            HStack {
                HStack(spacing: 0) {
                    Text(ChatContextUsage.tokens(usage.used)).fontWeight(.semibold)
                    if let window = usage.window {
                        Text(" of \(ChatContextUsage.tokens(window))").foregroundStyle(MobileStyle.muted)
                    }
                }
                .monospacedDigit()
                Spacer()
                if let windowOption {
                    Picker(
                        windowOption.text("label", fallback: "Context window"),
                        selection: Binding(
                            get: {
                                selection["options"]?[ChatContextUsage.windowOption]?.stringValue
                                    ?? windowOption.text("defaultChoice")
                            },
                            set: { updateOption(ChatContextUsage.windowOption, value: .string($0)) })
                    ) {
                        ForEach(Array(windowOption.list("choices").enumerated()), id: \.offset) { _, choice in
                            Text(choice.text("label")).tag(choice.text("id"))
                        }
                    }
                    .pickerStyle(.segmented).fixedSize()
                }
            }
            if usage.window != nil {
                ChatContextBar(usage: usage)
                    .accessibilityElement()
                    .accessibilityLabel("Context used")
                    .accessibilityValue("\(Int((usage.fraction * 100).rounded())) percent")
            }
            if let segments = usage.segments {
                ChatContextLegend(segments: segments)
            }
            if model.capabilities.text("compaction") != "none" {
                Button {
                    Task {
                        do {
                            _ = try await model.client.request("chat.compact", payload: model.target())
                            model.settingsProblem = nil
                        } catch { model.settingsProblem = error.localizedDescription }
                    }
                } label: {
                    Label("Compact now", lucideIcon: "minimize-2", iconSize: 15)
                }
                .disabled(model.working || usage.used == 0)
            }
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

    /// A session window warns as it fills, as the desktop's account rows do.
    static func tone(_ used: Double) -> Color {
        used >= 0.9 ? MobileStyle.statusError : used >= 0.7 ? MobileStyle.statusNeedsYou : MobileStyle.muted
    }
}

private enum ChatContextColors {
    static func of(_ part: ChatContextUsage.Part) -> Color {
        switch part {
        case .toolOutput: MobileStyle.chartContextTools
        case .filesRead: MobileStyle.chartContextFiles
        case .conversation: MobileStyle.chartContextConversation
        case .system: MobileStyle.faint
        }
    }
}

/// How full the context is, in its parts when the machine estimates them.
private struct ChatContextBar: View {
    let usage: ChatContextUsage

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                if let segments = usage.segments {
                    ForEach(segments, id: \.part) { segment in
                        ChatContextColors.of(segment.part)
                            .frame(width: max(0, geometry.size.width * segment.fraction))
                    }
                } else {
                    MobileStyle.accent.frame(width: geometry.size.width * usage.fraction)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(height: 8)
        .background(MobileStyle.text.opacity(0.1))
        .clipShape(Capsule())
    }
}

private struct ChatContextLegend: View {
    let segments: [ChatContextUsage.Segment]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)]) {
            ForEach(segments, id: \.part) { segment in
                HStack(spacing: 6) {
                    Circle().fill(ChatContextColors.of(segment.part)).frame(width: 7, height: 7)
                    Text("\(segment.part.label) \(ChatContextUsage.tokens(segment.tokens))").monospacedDigit()
                }
                .font(.caption).foregroundStyle(MobileStyle.muted)
            }
        }
    }
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
