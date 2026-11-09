import RuimtePulsar
import SwiftUI

struct UiPending: ViewModifier {
    let complete: Bool

    func body(content: Content) -> some View {
        content.opacity(complete ? 1 : 0.6).allowsHitTesting(complete)
    }
}

/// Local values only: nothing reaches the daemon or the agent until a Choice carries them in its context.
struct UiChecklistView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let values = node.currentValue?.arrayValue ?? []
        let enabled = context.editable(node)
        VStack(alignment: .leading, spacing: 6) {
            ForEach(node.children.filter { !$0.isText }) { child in
                if child.type == "Item" && child.error == nil {
                    let value = child.props["value"] ?? .null
                    UiItemView(
                        node: child, selected: values.contains(value), enabled: enabled,
                        toggle: { context.toggle(node, item: value) }, context: context)
                } else {
                    UiNodeView(node: child, parent: node.type, context: context)
                }
            }
        }
        .modifier(UiPending(complete: node.complete))
        .sensoryFeedback(.selection, trigger: values)
    }
}

/// A tile per item, ringed in the accent while it is checked. The whole tile is the label; a link inside it keeps its
/// own tap and checks nothing.
struct UiItemView: View {
    let node: UiNode
    let selected: Bool
    let enabled: Bool
    let toggle: () -> Void
    let context: UiRenderContext

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Button(action: toggle) {
                Image(lucide: selected ? "square-check" : "square", size: 18)
                    .foregroundStyle(selected ? MobileStyle.accent : MobileStyle.muted)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 6 }
            .accessibilityLabel(node.label)
            .accessibilityAddTraits(.isToggle)
            .accessibilityAddTraits(selected ? [.isSelected] : [])
            .accessibilityValue(selected ? String(localized: "On") : String(localized: "Off"))
            UiNodesView(nodes: node.children, parent: node.type, context: context)
                .font(.subheadline).foregroundStyle(MobileStyle.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityHidden(node.children.allSatisfy(\.isText))
        }
        .padding(.horizontal, UiTileStyle.padding).padding(.vertical, 8)
        .frame(minHeight: 44)
        .uiTile(horizontal: 0, vertical: 0)
        .overlay {
            if selected {
                RoundedRectangle(cornerRadius: UiTileStyle.radius).strokeBorder(MobileStyle.accent, lineWidth: 2)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: UiTileStyle.radius))
        .onTapGesture { if enabled { toggle() } }
    }
}

struct UiSwitchView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let value = node.currentValue?.boolValue ?? false
        Toggle(isOn: Binding(get: { value }, set: { context.change(node, to: .bool($0)) })) {
            UiNodesView(nodes: node.children, parent: node.type, context: context)
                .font(.subheadline.weight(.medium)).foregroundStyle(MobileStyle.text)
        }
        .disabled(!context.editable(node))
        .accessibilityLabel(node.label)
        .frame(minHeight: 44)
        .uiTile(flat: true, vertical: 0)
        .modifier(UiPending(complete: node.complete))
        .sensoryFeedback(.selection, trigger: value)
    }
}

/// The label on the left and the value on the right, the track under them. The value follows the finger at once;
/// while it drags the block evaluates at most every tenth of a second, and once more where it lets go.
struct UiSliderView: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var draft: Double?
    @State private var dragging = false
    @State private var lastSent: ContinuousClock.Instant?

    private static let dragInterval: Duration = .milliseconds(100)

    var body: some View {
        let bound = node.currentValue?.numberValue ?? 0
        let low = node.number("min") ?? 0
        let high = max(low + .ulpOfOne, node.number("max") ?? 1)
        let step = node.number("step").flatMap { $0 > 0 ? $0 : nil }
        let value = min(high, max(low, draft ?? bound))
        let reading = UiFormat.withUnit(UiFormat.number(value), node.string("unit"))
        let binding = Binding(get: { value }, set: { move(to: $0, bound: bound) })
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(node.label).font(.subheadline).foregroundStyle(MobileStyle.text)
                Spacer(minLength: 12)
                Text(reading).font(.subheadline).foregroundStyle(MobileStyle.muted).monospacedDigit()
            }
            .accessibilityHidden(true)
            Group {
                if let step {
                    Slider(value: binding, in: low...high, step: step, onEditingChanged: editing)
                } else {
                    Slider(value: binding, in: low...high, onEditingChanged: editing)
                }
            }
            .tint(MobileStyle.accent)
            .disabled(!context.editable(node))
            .accessibilityLabel(node.label)
            .accessibilityValue(reading)
        }
        .frame(minHeight: 44)
        .uiTile(flat: true)
        .modifier(UiPending(complete: node.complete))
        .sensoryFeedback(.selection, trigger: value)
    }

    private func move(to next: Double, bound: Double) {
        draft = next
        guard dragging else {
            settle()
            return
        }
        let now = ContinuousClock.now
        if next != bound, lastSent.map({ $0.duration(to: now) >= Self.dragInterval }) ?? true {
            lastSent = now
            context.change(node, to: .number(next))
        }
    }

    private func editing(_ started: Bool) {
        dragging = started
        if !started { settle() }
    }

    /// Sends where the slider came to rest and then shows what the block made of it, even a value it refused or
    /// rounded, so the slider never sticks on a draft.
    private func settle() {
        lastSent = nil
        guard let value = draft else { return }
        Task {
            await context.apply(node, .number(value))
            if !dragging && draft == value { draft = nil }
        }
    }
}

/// The Options of a Segmented or Select, each picked by its place, since a value may be any scalar.
@MainActor private struct UiOptions {
    let options: [UiNode]
    /// The place of the option the value names; -1 for none.
    let picked: Int
    let selection: Binding<Int>

    init(_ node: UiNode, context: UiRenderContext) {
        let current = node.currentValue ?? .null
        let options = node.children(of: "Option")
        let picked = options.firstIndex { $0.props["value"] == current } ?? -1
        self.options = options
        self.picked = picked
        selection = Binding(
            get: { picked },
            set: { index in
                if options.indices.contains(index) { context.change(node, to: options[index].props["value"] ?? .null) }
            })
    }

    var rows: some View {
        ForEach(Array(options.enumerated()), id: \.element.id) { index, option in Text(option.label).tag(index) }
    }
}

/// Left aligned and never wider than its options; when they do not fit the card, a menu of the same options.
struct UiSegmentedView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let options = UiOptions(node, context: context)
        ViewThatFits(in: .horizontal) {
            Picker(String(localized: "Options"), selection: options.selection) { options.rows }
                .pickerStyle(.segmented).fixedSize()
            Picker(String(localized: "Options"), selection: options.selection) { options.rows }
                .pickerStyle(.menu).tint(MobileStyle.text)
        }
        .disabled(!context.editable(node))
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(UiPending(complete: node.complete))
        .sensoryFeedback(.selection, trigger: options.picked)
    }
}

/// A line of text with its label above, which stops taking characters at its limit. Nothing here submits: the text
/// reaches the agent only through a Choice. What is typed shows at once and the block evaluates it right behind.
struct UiTextFieldView: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var draft: String?
    @FocusState private var focused: Bool

    private static let defaultLimit = 256
    /// The count under the field appears once the field is this full, and never nags before.
    private static let countFrom = 0.8

    var body: some View {
        let limit = node.number("maxLength").map { Int($0) } ?? Self.defaultLimit
        let bound = node.currentValue?.stringValue ?? ""
        let text = draft ?? bound
        let used = text.utf16.count
        VStack(alignment: .leading, spacing: 6) {
            UiNodesView(nodes: node.children, parent: node.type, context: context)
                .font(.caption).foregroundStyle(MobileStyle.muted).padding(.horizontal, 2)
                .accessibilityHidden(true)
            TextField(
                node.label, text: Binding(get: { text }, set: { draft = $0 }),
                prompt: node.string("placeholder").map { Text(verbatim: $0) }
            )
            .font(.subheadline).foregroundStyle(MobileStyle.text)
            .focused($focused).submitLabel(.done).onSubmit { focused = false }
            .disabled(!context.editable(node))
            .padding(.horizontal, 10).frame(minHeight: 36)
            .uiTile(horizontal: 0, vertical: 0)
            .frame(maxWidth: 384, alignment: .leading)
            .accessibilityLabel(node.label)
            if Double(used) >= Double(limit) * Self.countFrom {
                Text("\(UiFormat.number(Double(used))) of \(UiFormat.number(Double(limit))) characters")
                    .font(.caption).foregroundStyle(MobileStyle.muted).monospacedDigit()
            }
        }
        .modifier(UiPending(complete: node.complete))
        .onChange(of: draft) { _, typed in
            guard let typed else { return }
            let kept = UiTextLimit.clamp(typed, to: limit)
            guard kept == typed else {
                draft = kept
                return
            }
            Task {
                await context.apply(node, .string(kept))
                if draft == kept { draft = nil }
            }
        }
    }
}

struct UiSelectView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let options = UiOptions(node, context: context)
        let label = node.ownLabel
        VStack(alignment: .leading, spacing: 6) {
            if !label.isEmpty {
                Text(label).font(.caption).foregroundStyle(MobileStyle.muted).padding(.horizontal, 2)
                    .accessibilityHidden(true)
            }
            Picker(label.isEmpty ? String(localized: "Options") : label, selection: options.selection) { options.rows }
                .pickerStyle(.menu).tint(MobileStyle.text).labelsHidden()
                .disabled(options.options.isEmpty || !context.editable(node))
                .accessibilityLabel(label.isEmpty ? String(localized: "Options") : label)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(UiPending(complete: node.complete))
        .sensoryFeedback(.selection, trigger: options.picked)
    }
}

/// A local action as a bordered button with its children as the label. It sets local values only; like an input it
/// closes once the block is answered.
struct UiButtonView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let enabled = context.runnable(node)
        Button {
            context.run(node)
        } label: {
            UiNodesView(nodes: node.children, parent: node.type, context: context)
                .font(.subheadline.weight(.medium)).foregroundStyle(MobileStyle.text)
                .padding(.horizontal, 14).frame(minHeight: 36)
                .background(UiTileStyle.tile, in: Capsule())
                .overlay { Capsule().strokeBorder(MobileStyle.border) }
                .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled || !node.complete ? 1 : 0.5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(node.label)
        .accessibilityAddTraits(.isButton)
        .modifier(UiPending(complete: node.complete))
    }
}
