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
    var queue = false
}

/// The row under the field: attach and mention, the queue, and how the next turn runs, one pill for each part. Each
/// setting is a menu that grows out of its pill.
struct ChatComposerPills: View {
    @Bindable var model: ChatModel
    let sheets: ChatComposerSheets
    @Binding var focused: Bool

    private var effort: JSONValue? {
        model.selectedModel.list("options").first { $0.text("id") == "effort" && $0.text("type") == "select" }
    }

    var body: some View {
        ScrollView(.horizontal) {
            // No GlassEffectContainer: since iOS 26.1 a menu inside one no longer morphs out of its label.
            HStack(spacing: 8) {
                addMenu
                if !model.queue.isEmpty { queuePill }
                Group {
                    modelMenu
                    if let effort { effortMenu(effort) }
                    permissionsMenu
                }
                .disabled(!model.canConfigure)
            }
            .frame(minHeight: 44)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .disabled(model.queueBusy)
    }

    private var addMenu: some View {
        Menu {
            if model.canAttach {
                Button(String(localized: "Photos"), lucideIcon: "image") { open { sheets.photos = true } }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button(String(localized: "Camera"), lucideIcon: "camera") { open { sheets.camera = true } }
                }
                Button(String(localized: "File"), lucideIcon: "paperclip") { open { sheets.files = true } }
            }
            Section {
                Button(String(localized: "Mention file"), lucideIcon: "at-sign") {
                    open { sheets.picker = "@" }
                }
                Button(String(localized: "Refer to view or node"), lucideIcon: "hash") {
                    open { sheets.picker = "#" }
                }
                Button(String(localized: "Use skill"), lucideIcon: "zap") { open { sheets.picker = "$" } }
                Button(String(localized: "Command"), lucideIcon: "square-slash") { open { sheets.picker = "/" } }
            }
            .disabled(!model.connected)
            Button(String(localized: "Expand editor"), lucideIcon: "maximize-2") { open { sheets.expanded = true } }
        } label: {
            Image(lucide: "plus", size: 18).foregroundStyle(MobileStyle.text)
                .frame(width: 38, height: 38)
        }
        .buttonStyle(MobileGlassButtonStyle(shape: .circle))
        .accessibilityLabel("Add context or expand editor")
    }

    private var queuePill: some View {
        Button {
            focused = false
            sheets.queue = true
        } label: {
            HStack(spacing: 6) {
                Text("\(model.queue.count)").font(.caption.weight(.semibold)).monospacedDigit()
                    .padding(.horizontal, 5).frame(minWidth: 18, minHeight: 18)
                    .background(MobileStyle.text.opacity(0.14), in: Capsule())
                Text("In queue")
            }
            .modifier(ChatComposerPill())
        }
        .buttonStyle(MobileGlassButtonStyle(shape: .capsule))
        .accessibilityLabel("\(model.queue.count) messages in queue")
    }

    private var modelMenu: some View {
        let slug = model.selection.text("model")
        let name = slug.isEmpty ? String(localized: "Choose model") : ModelName.of(slug, in: model.models)
        let live = model.models.filter { $0["legacy"]?.boolValue != true }
        let legacy = model.models.filter { $0["legacy"]?.boolValue == true }
        let choice = Binding(get: { slug }, set: { if $0 != slug { model.chooseModel($0) } })
        return Menu {
            Picker("Model", selection: choice) { modelRows(live) }.pickerStyle(.inline)
            if !legacy.isEmpty {
                Menu {
                    Picker("Legacy models", selection: choice) { modelRows(legacy) }.pickerStyle(.inline)
                } label: {
                    Text("Legacy models")
                    if let current = legacy.first(where: { $0.text("slug") == slug }) {
                        Text(current.text("name", fallback: ModelName.fromSlug(slug)))
                    }
                }
            }
            Section {
                Button(String(localized: "Run settings"), lucideIcon: "settings") {
                    open { sheets.settings = true }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Group {
                    if model.provider.isEmpty {
                        Image(lucide: "settings", size: 14)
                    } else {
                        ChatProviderMark(provider: model.provider, size: 14)
                    }
                }
                .foregroundStyle(model.accountTint ?? MobileStyle.muted)
                Text(ModelName.short(name, in: model.models)).lineLimit(1)
                Image(lucide: "chevron-down", size: 12).foregroundStyle(MobileStyle.muted)
            }
            .modifier(ChatComposerPill())
        }
        .buttonStyle(MobileGlassButtonStyle(shape: .capsule))
        .accessibilityLabel("Model, \(name)")
        .accessibilityValue(model.accountChoice?.name(provider: usageProviderName(model.provider)) ?? "")
        .accessibilityAction(named: "Run settings") { open { sheets.settings = true } }
    }

    private func modelRows(_ models: [JSONValue]) -> some View {
        ForEach(Array(models.enumerated()), id: \.offset) { _, option in
            Text(option.text("name", fallback: ModelName.fromSlug(option.text("slug")))).tag(option.text("slug"))
        }
    }

    private func effortMenu(_ option: JSONValue) -> some View {
        let current = model.selection["options"]?["effort"]?.stringValue ?? option.text("defaultChoice")
        let choices = option.list("choices")
        let label = choices.first { $0.text("id") == current }?.text("label") ?? current
        return Menu {
            Picker(
                option.text("label", fallback: String(localized: "Effort")),
                selection: Binding(
                    get: { current },
                    set: { if $0 != current { model.chooseOption("effort", value: .string($0)) } })
            ) {
                ForEach(Array(choices.enumerated()), id: \.offset) { _, choice in
                    Label {
                        Text(choice.text("label", fallback: choice.text("id")))
                        if !choice.text("description").isEmpty { Text(choice.text("description")) }
                    } icon: {
                        EmptyView()
                    }
                    .tag(choice.text("id"))
                }
            }
            .pickerStyle(.inline)
        } label: {
            HStack(spacing: 6) {
                Image(lucide: "sliders-horizontal", size: 14).foregroundStyle(MobileStyle.muted)
                Text(label).lineLimit(1)
            }
            .modifier(ChatComposerPill())
        }
        .buttonStyle(MobileGlassButtonStyle(shape: .capsule))
        .accessibilityLabel(option.text("label", fallback: String(localized: "Effort")))
        .accessibilityValue(label)
    }

    private var permissionsMenu: some View {
        let mode = model.runtimeMode
        let full = mode == "full-access"
        return Menu {
            Picker(
                "Permissions", selection: Binding(get: { mode }, set: { if $0 != mode { model.chooseMode($0) } })
            ) {
                ForEach(ChatRuntimeMode.all, id: \.self) { value in
                    Label {
                        Text(ChatRuntimeMode.label(value))
                        Text(ChatRuntimeMode.hint(value))
                    } icon: {
                        Image(lucide: ChatRuntimeMode.icon(value), size: 16)
                    }
                    .tag(value)
                }
            }
            .pickerStyle(.inline)
        } label: {
            HStack(spacing: 6) {
                Image(lucide: ChatRuntimeMode.icon(mode), size: 14)
                    .foregroundStyle(full ? MobileStyle.statusNeedsYou : MobileStyle.muted)
                Text(ChatRuntimeMode.short(mode)).lineLimit(1)
                    .foregroundStyle(full ? MobileStyle.statusNeedsYou : MobileStyle.text)
            }
            .modifier(ChatComposerPill())
        }
        .buttonStyle(MobileGlassButtonStyle(shape: .capsule))
        .accessibilityLabel("Permissions")
        .accessibilityValue(ChatRuntimeMode.label(mode))
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
    }
}
