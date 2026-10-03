import RuimtePulsar
import SwiftUI
import UIKit

/// What the controls around the field ask it to open. The pickers stay with the field, since they fill its draft.
@MainActor @Observable final class ChatComposerSheets {
    var photos = false
    var camera = false
    var files = false
    /// The trigger of the context picker: `@`, `$` or `/`.
    var picker: String?
    var expanded = false
    var settings = false
    var compare = false
}

/// The row under the field: attach and mention, the queue, and how the next turn runs, one pill for each part. Each
/// setting opens its own flyout over the pill; a long press on the model opens Run settings.
struct ChatComposerPills: View {
    @Bindable var model: ChatModel
    let sheets: ChatComposerSheets
    @Binding var focused: Bool
    @State private var showingQueue = false
    @State private var flyout: Flyout?
    /// A sheet asked for from a flyout, opened once the flyout has gone so the two do not cross.
    @State private var afterFlyout: (() -> Void)?
    @State private var showingLegacy = false
    @State private var settingsPress = 0

    private enum Flyout: Hashable {
        case model, effort, permissions
    }

    private var effort: JSONValue? {
        model.selectedModel.list("options").first { $0.text("id") == "effort" && $0.text("type") == "select" }
    }

    private var account: ProviderAccountEntry? {
        let kind = model.info.text("provider")
        guard let accounts = model.accounts, accounts.hasChoice(kind) else { return nil }
        let id = model.info["account"]?.stringValue ?? kind
        return accounts.entries.first { $0.kind == kind && $0.id == id }
    }

    var body: some View {
        ScrollView(.horizontal) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    addMenu
                    if !model.queue.isEmpty { queuePill }
                    Group {
                        modelPill
                        if let effort { effortPill(effort) }
                        permissionsPill
                    }
                    .disabled(!model.canConfigure)
                }
            }
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .disabled(model.queueBusy)
        .mobileSheet(isPresented: $showingQueue) {
            ChatQueueSheet(model: model) { focused = true }
        }
        .onChange(of: flyout) { _, next in
            guard next == nil, let action = afterFlyout else { return }
            afterFlyout = nil
            action()
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: settingsPress)
    }

    private var addMenu: some View {
        Menu {
            if model.canAttach {
                Button("Photos", lucideIcon: "image") { open { sheets.photos = true } }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button("Camera", lucideIcon: "camera") { open { sheets.camera = true } }
                }
                Button("File", lucideIcon: "paperclip") { open { sheets.files = true } }
            }
            Section {
                Button("Mention file or chat", lucideIcon: "at-sign") { open { sheets.picker = "@" } }
                Button("Use skill", lucideIcon: "sparkles") { open { sheets.picker = "$" } }
                Button("Command", lucideIcon: "circle-slash") { open { sheets.picker = "/" } }
            }
            .disabled(!model.connected)
            Button("Expand editor", lucideIcon: "maximize-2") { open { sheets.expanded = true } }
        } label: {
            Image(lucide: "plus", size: 18).foregroundStyle(MobileStyle.text)
                .frame(width: 38, height: 38)
                .glassEffect(.regular.interactive(), in: .circle)
                .frame(minHeight: 44).contentShape(Rectangle())
        }
        .accessibilityLabel("Add context or expand editor")
    }

    private var queuePill: some View {
        Button {
            focused = false
            showingQueue = true
        } label: {
            HStack(spacing: 6) {
                Text("\(model.queue.count)").font(.caption.weight(.semibold)).monospacedDigit()
                    .padding(.horizontal, 5).frame(minWidth: 18, minHeight: 18)
                    .background(MobileStyle.text.opacity(0.14), in: Capsule())
                Text("In queue")
            }
            .modifier(ChatComposerPill())
        }
        .buttonStyle(ChatComposerButtonStyle())
        .accessibilityLabel(model.queue.count == 1 ? "1 message in queue" : "\(model.queue.count) messages in queue")
    }

    private var modelName: String {
        let slug = model.selection.text("model")
        return slug.isEmpty ? "Choose model" : ModelName.of(slug, in: model.models)
    }

    /// A tap opens the models, a long press Run settings, so it does not use a button, which would answer both.
    private var modelPill: some View {
        HStack(spacing: 6) {
            Image(lucide: "sparkles", size: 14).foregroundStyle(MobileStyle.muted)
            Text(ModelName.short(modelName, in: model.models)).lineLimit(1)
            if let account { AccountDot(color: account.color, size: 6) }
            Image(lucide: "chevron-down", size: 12).foregroundStyle(MobileStyle.muted)
        }
        .modifier(ChatComposerPill())
        .onTapGesture { show(.model) }
        .onLongPressGesture(minimumDuration: 0.4) {
            guard model.canConfigure else { return }
            settingsPress += 1
            open { sheets.settings = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Model, \(modelName)")
        .accessibilityValue(account?.name(provider: usageProviderName(model.info.text("provider"))) ?? "")
        .accessibilityHint("Touch and hold for run settings")
        .accessibilityAction { show(.model) }
        .accessibilityAction(named: "Run settings") { open { sheets.settings = true } }
        .popover(isPresented: binding(.model), arrowEdge: .bottom) { modelFlyout }
    }

    private var modelFlyout: some View {
        let slug = model.selection.text("model")
        let live = model.models.filter { $0["legacy"]?.boolValue != true }
        let legacy = model.models.filter { $0["legacy"]?.boolValue == true }
        return ChatFlyout(heading: "Model") {
            ForEach(Array(live.enumerated()), id: \.offset) { _, option in modelRow(option, current: slug) }
            if !legacy.isEmpty {
                ChatFlyoutRow(
                    title: "Legacy models",
                    detail: legacy.first { $0.text("slug") == slug }.map { $0.text("name") },
                    trailing: showingLegacy ? "chevron-up" : "chevron-down"
                ) {
                    showingLegacy.toggle()
                }
                if showingLegacy || legacy.contains(where: { $0.text("slug") == slug }) {
                    ForEach(Array(legacy.enumerated()), id: \.offset) { _, option in modelRow(option, current: slug) }
                }
            }
            ChatFlyoutDivider()
            ChatFlyoutRow(title: "Run settings", icon: "sliders-horizontal") {
                close { open { sheets.settings = true } }
            }
            ChatFlyoutRow(title: "Compare models", icon: "chart-spline") {
                close { open { sheets.compare = true } }
            }
        }
    }

    private func modelRow(_ option: JSONValue, current: String) -> some View {
        let slug = option.text("slug")
        return ChatFlyoutRow(
            title: option.text("name", fallback: ModelName.fromSlug(slug)), checked: slug == current
        ) {
            if slug != current { model.chooseModel(slug) }
            flyout = nil
        }
    }

    private func effortPill(_ option: JSONValue) -> some View {
        let current = model.selection["options"]?["effort"]?.stringValue ?? option.text("defaultChoice")
        let choices = option.list("choices")
        let label = choices.first { $0.text("id") == current }?.text("label") ?? current
        return Button {
            show(.effort)
        } label: {
            HStack(spacing: 6) {
                Image(lucide: "sliders-horizontal", size: 14).foregroundStyle(MobileStyle.muted)
                Text(label).lineLimit(1)
            }
            .modifier(ChatComposerPill())
        }
        .buttonStyle(ChatComposerButtonStyle())
        .accessibilityLabel(option.text("label", fallback: "Effort"))
        .accessibilityValue(label)
        .popover(isPresented: binding(.effort), arrowEdge: .bottom) {
            ChatFlyout(heading: option.text("label", fallback: "Effort")) {
                ForEach(Array(choices.enumerated()), id: \.offset) { _, choice in
                    let id = choice.text("id")
                    ChatFlyoutRow(
                        title: choice.text("label", fallback: id), detail: choice.text("description"),
                        checked: id == current
                    ) {
                        if id != current { model.chooseOption("effort", value: .string(id)) }
                        flyout = nil
                    }
                }
            }
        }
    }

    private var permissionsPill: some View {
        let mode = model.runtimeMode
        let full = mode == "full-access"
        return Button {
            show(.permissions)
        } label: {
            HStack(spacing: 6) {
                Image(lucide: ChatRuntimeMode.icon(mode), size: 14)
                    .foregroundStyle(full ? MobileStyle.statusNeedsYou : MobileStyle.muted)
                Text(ChatRuntimeMode.short(mode)).lineLimit(1)
                    .foregroundStyle(full ? MobileStyle.statusNeedsYou : MobileStyle.text)
            }
            .modifier(ChatComposerPill())
        }
        .buttonStyle(ChatComposerButtonStyle())
        .accessibilityLabel("Permissions")
        .accessibilityValue(ChatRuntimeMode.label(mode))
        .popover(isPresented: binding(.permissions), arrowEdge: .bottom) {
            ChatFlyout(heading: "Permissions", width: 280) {
                ForEach(ChatRuntimeMode.all, id: \.self) { value in
                    ChatFlyoutRow(
                        title: ChatRuntimeMode.label(value), detail: ChatRuntimeMode.hint(value),
                        detailColor: value == "full-access" ? MobileStyle.statusNeedsYou : MobileStyle.muted,
                        icon: ChatRuntimeMode.icon(value), checked: value == mode
                    ) {
                        if value != mode { model.chooseMode(value) }
                        flyout = nil
                    }
                }
            }
        }
    }

    private func binding(_ kind: Flyout) -> Binding<Bool> {
        Binding(get: { flyout == kind }, set: { if !$0, flyout == kind { flyout = nil } })
    }

    private func show(_ kind: Flyout) {
        guard model.canConfigure, !model.queueBusy else { return }
        focused = false
        flyout = kind
    }

    /// Closes the flyout and runs `action` once it has gone.
    private func close(then action: @escaping () -> Void) {
        afterFlyout = action
        flyout = nil
    }

    /// Lets the keyboard go before a picker comes up, so the two do not animate over each other.
    private func open(_ presentation: () -> Void) {
        focused = false
        presentation()
    }
}

private struct ChatComposerPill: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.subheadline.weight(.medium)).foregroundStyle(MobileStyle.text)
            .padding(.horizontal, 13).frame(minHeight: 38)
            .glassEffect(.regular.interactive(), in: .capsule)
            .frame(minHeight: 44).contentShape(Rectangle())
    }
}
