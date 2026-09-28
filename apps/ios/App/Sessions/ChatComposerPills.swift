import RuimtePulsar
import SwiftUI
import UIKit

/// What the controls around the field ask it to open. The pickers stay with the field, since they fill its draft and
/// it stays mounted while a prompt card stands in its place.
@MainActor @Observable final class ChatComposerSheets {
    var photos = false
    var camera = false
    var files = false
    /// The trigger of the context picker: `@`, `$` or `/`.
    var picker: String?
    var expanded = false
    var settings = false
}

/// The row under the field: attach and mention, the queue, and how the next turn runs, one pill for each part.
struct ChatComposerPills: View {
    @Bindable var model: ChatModel
    let sheets: ChatComposerSheets
    @Binding var focused: Bool
    @State private var showingQueue = false

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
                        modelMenu
                        if let effort { effortMenu(effort) }
                        permissionsMenu
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

    private var modelMenu: some View {
        let slug = model.selection.text("model")
        let name = slug.isEmpty ? "Choose model" : ModelName.of(slug, in: model.models)
        let live = model.models.filter { $0["legacy"]?.boolValue != true }
        let legacy = model.models.filter { $0["legacy"]?.boolValue == true }
        let choice = Binding(get: { slug }, set: { model.chooseModel($0) })
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
                Button("All run settings", lucideIcon: "sliders-horizontal") {
                    focused = false
                    sheets.settings = true
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(lucide: "sparkles", size: 14).foregroundStyle(MobileStyle.muted)
                Text(ModelName.short(name, in: model.models)).lineLimit(1)
                if let account { AccountDot(color: account.color, size: 6) }
                Image(lucide: "chevron-down", size: 12).foregroundStyle(MobileStyle.muted)
            }
            .modifier(ChatComposerPill())
        }
        .accessibilityLabel("Model, \(name)")
        .accessibilityValue(account?.name(provider: usageProviderName(model.info.text("provider"))) ?? "")
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
                option.text("label", fallback: "Effort"),
                selection: Binding(get: { current }, set: { model.chooseOption("effort", value: .string($0)) })
            ) {
                ForEach(Array(choices.enumerated()), id: \.offset) { _, choice in
                    Label {
                        Text(choice.text("label"))
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
        .accessibilityLabel(option.text("label", fallback: "Effort"))
        .accessibilityValue(label)
    }

    private var permissionsMenu: some View {
        let mode = model.runtimeMode
        let full = mode == "full-access"
        return Menu {
            Picker("Permissions", selection: Binding(get: { mode }, set: { model.chooseMode($0) })) {
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
            .glassEffect(.regular.interactive(), in: .capsule)
            .frame(minHeight: 44).contentShape(Rectangle())
    }
}
