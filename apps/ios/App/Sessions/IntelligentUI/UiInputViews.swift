import RuimtePulsar
import SwiftUI

/// An input whose node has not closed yet stands at 60% and takes no touch.
private struct UiPending: ViewModifier {
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
        let values = (node.boundValue ?? node.props["value"])?.arrayValue ?? []
        let enabled = context.editable(node)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(node.children.filter { !$0.isText }) { child in
                if child.type == "Item" && child.error == nil {
                    let value = child.props["value"] ?? .null
                    UiItemView(
                        node: child, selected: values.contains(value), enabled: enabled,
                        toggle: {
                            let next = values.contains(value) ? values.filter { $0 != value } : values + [value]
                            context.change(node, to: .array(next))
                        }, context: context)
                } else {
                    UiNodeView(node: child, parent: node.type, context: context)
                }
            }
        }
        .modifier(UiPending(complete: node.complete))
        .sensoryFeedback(.selection, trigger: values)
    }
}

/// The whole row is the label; a link inside it keeps its own tap and checks nothing.
struct UiItemView: View {
    let node: UiNode
    let selected: Bool
    let enabled: Bool
    let toggle: () -> Void
    let context: UiRenderContext

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
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
        .padding(.horizontal, 8).padding(.vertical, 6)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .onTapGesture { if enabled { toggle() } }
    }
}

struct UiSwitchView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let value = (node.boundValue ?? node.props["value"])?.boolValue ?? false
        Toggle(isOn: Binding(get: { value }, set: { context.change(node, to: .bool($0)) })) {
            UiNodesView(nodes: node.children, parent: node.type, context: context)
                .font(.subheadline).foregroundStyle(MobileStyle.text)
        }
        .disabled(!context.editable(node))
        .accessibilityLabel(node.label)
        .padding(.horizontal, 8).frame(minHeight: 44)
        .modifier(UiPending(complete: node.complete))
        .sensoryFeedback(.selection, trigger: value)
    }
}

/// The label on the left and the value on the right, the track under them. The value follows the finger at once
/// and the block evaluates again on every step it lands on.
struct UiSliderView: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var draft: Double?

    var body: some View {
        let bound = (node.boundValue ?? node.props["value"])?.numberValue ?? 0
        let low = node.number("min") ?? 0
        let high = max(low + .ulpOfOne, node.number("max") ?? 1)
        let step = node.number("step").flatMap { $0 > 0 ? $0 : nil }
        let value = min(high, max(low, draft ?? bound))
        let reading = UiFormat.withUnit(UiFormat.number(value), node.string("unit"))
        let binding = Binding(
            get: { value },
            set: { next in
                draft = next
                if next != bound { context.change(node, to: .number(next)) }
            })
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(node.label).font(.subheadline).foregroundStyle(MobileStyle.text)
                Spacer(minLength: 12)
                Text(reading).font(.subheadline).foregroundStyle(MobileStyle.muted).monospacedDigit()
            }
            .accessibilityHidden(true)
            Group {
                if let step {
                    Slider(value: binding, in: low...high, step: step)
                } else {
                    Slider(value: binding, in: low...high)
                }
            }
            .tint(MobileStyle.accent)
            .disabled(!context.editable(node))
            .accessibilityLabel(node.label)
            .accessibilityValue(reading)
        }
        .padding(.horizontal, 8).frame(minHeight: 44)
        .modifier(UiPending(complete: node.complete))
        .onChange(of: bound) { _, next in
            if next == draft { draft = nil }
        }
        .sensoryFeedback(.selection, trigger: value)
    }
}

/// Left aligned and never wider than its options; when they do not fit the card, a menu of the same options. Each
/// Option is picked by its place, since a value may be any scalar.
struct UiSegmentedView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let current = node.boundValue ?? node.props["value"] ?? .null
        let options = node.children(of: "Option")
        let picked = options.firstIndex { $0.props["value"] == current } ?? -1
        let selection = Binding(
            get: { picked },
            set: { index in
                if options.indices.contains(index) { context.change(node, to: options[index].props["value"] ?? .null) }
            })
        ViewThatFits(in: .horizontal) {
            Picker(String(localized: "Options"), selection: selection) {
                ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                    Text(option.label).tag(index)
                }
            }
            .pickerStyle(.segmented).fixedSize()
            Picker(String(localized: "Options"), selection: selection) {
                ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                    Text(option.label).tag(index)
                }
            }
            .pickerStyle(.menu).tint(MobileStyle.text)
        }
        .disabled(!context.editable(node))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .modifier(UiPending(complete: node.complete))
        .sensoryFeedback(.selection, trigger: picked)
    }
}
