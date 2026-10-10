import RuimtePulsar
import SwiftUI

/// Up to four tabs as a segmented picker, more as a row of capsules that scrolls. A tab that arrives while the block
/// streams is not picked: the one that was open stays open.
struct UiTabsView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let tabs = node.children(of: "Tab")
        let key = "tabs:\(node.id)"
        let picked = context.local.pick(key).flatMap { id in tabs.first { $0.id == id } } ?? tabs.first
        let selection = Binding(get: { picked?.id ?? "" }, set: { context.local.setPick(key, $0) })
        VStack(alignment: .leading, spacing: 10) {
            if tabs.count <= 4 {
                Picker(String(localized: "Options"), selection: selection) {
                    ForEach(tabs) { tab in Text(tab.string("title") ?? "").tag(tab.id) }
                }
                .pickerStyle(.segmented).padding(.horizontal, 8)
            } else {
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(tabs) { tab in
                            let chosen = tab.id == picked?.id
                            Button {
                                selection.wrappedValue = tab.id
                            } label: {
                                Text(tab.string("title") ?? "").font(.footnote.weight(.medium))
                                    .foregroundStyle(chosen ? MobileStyle.onAccent : MobileStyle.text)
                                    .padding(.horizontal, 12).frame(minHeight: 32)
                                    .background(chosen ? MobileStyle.accent : MobileStyle.hover, in: Capsule())
                                    .frame(minHeight: 44).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(chosen ? [.isSelected] : [])
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .scrollIndicators(.hidden)
            }
            if let picked {
                UiNodesView(nodes: picked.children, parent: "Tab", context: context).id(picked.id)
            }
        }
        .sensoryFeedback(.selection, trigger: picked?.id)
    }
}

/// Every section arrives open until the person folds one of the set; after that nothing opens by itself.
struct UiSectionsView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let sections = node.children.filter { !$0.isText }
        let touched = context.local.flag("sections:\(node.id)") == true
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
                if index > 0 { Divider().overlay(MobileStyle.border) }
                if section.type == "Section" && section.error == nil {
                    UiSectionView(node: section, touched: touched, context: context) {
                        context.local.setFlag("sections:\(node.id)", true)
                    }
                } else {
                    UiNodeView(node: section, parent: node.type, context: context)
                }
            }
        }
    }
}

struct UiSectionView: View {
    let node: UiNode
    let touched: Bool
    let context: UiRenderContext
    var touch: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let key = "section:\(node.id)"
        let open = context.local.flag(key) ?? !touched
        VStack(alignment: .leading, spacing: 0) {
            Button {
                touch()
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) { context.local.setFlag(key, !open) }
            } label: {
                HStack(spacing: 8) {
                    Image(lucide: "chevron-right", size: 14).foregroundStyle(MobileStyle.faint)
                        .rotationEffect(.degrees(open ? 90 : 0))
                    Text(node.string("title") ?? "").font(.subheadline.weight(.medium))
                        .foregroundStyle(MobileStyle.text).lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 8).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(open ? String(localized: "Expanded") : String(localized: "Collapsed"))
            if open {
                UiNodesView(nodes: node.children, parent: "Section", context: context)
                    .padding(.leading, 30).padding(.trailing, 8).padding(.bottom, 10)
            }
        }
    }
}
