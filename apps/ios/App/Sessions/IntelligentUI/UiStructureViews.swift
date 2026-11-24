import RuimtePulsar
import SwiftUI

/// The tabs as wide as their titles on a tile, like a segmented control, scrolling sideways when they run past the
/// block. A tab that arrives while the block streams is not picked: the one that was open stays open.
struct UiTabsView: View {
    let node: UiNode
    let context: UiRenderContext
    @Environment(\.uiInSection) private var inSection

    var body: some View {
        let tabs = node.children(of: "Tab")
        let key = "tabs:\(node.id)"
        let picked = context.local.pick(key).flatMap { id in tabs.first { $0.id == id } } ?? tabs.first
        VStack(alignment: .leading, spacing: 12) {
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(tabs) { tab in
                        let chosen = tab.id == picked?.id
                        Button {
                            context.local.setPick(key, tab.id)
                        } label: {
                            HStack(spacing: 6) {
                                Text(tab.string("title") ?? "").font(.subheadline.weight(.medium)).lineLimit(1)
                                    .foregroundStyle(chosen ? MobileStyle.text : MobileStyle.muted)
                                if let badge = tab.string("badge"), !badge.isEmpty {
                                    UiPill(text: badge, pill: .muted).monospacedDigit()
                                }
                            }
                            .padding(.horizontal, 10).frame(minHeight: 32)
                            .background(chosen ? MobileStyle.active : .clear, in: RoundedRectangle(cornerRadius: 9))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(chosen ? [.isSelected] : [])
                    }
                }
                .padding(3)
                .background(
                    inSection ? UiTileStyle.inset : UiTileStyle.tile,
                    in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
            }
            .scrollIndicators(.hidden).scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(String(localized: "Options"))
            if let picked {
                UiNodesView(nodes: picked.children, parent: "Tab", context: context, spacing: 12).id(picked.id)
            }
        }
        .sensoryFeedback(.selection, trigger: picked?.id)
    }
}

/// A section arrives as its `open` says. Without it every section arrives open until the person folds one of the set;
/// after that nothing opens by itself.
struct UiSectionsView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let sections = node.children.filter { !$0.isText }
        let touched = context.local.flag("sections:\(node.id)") == true
        VStack(alignment: .leading, spacing: 6) {
            ForEach(sections) { section in
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

/// A tile with its title as the fold and its badge as a tag at the end of it, in the section's tone. Its content
/// keeps one margin on both sides, and the parts in it line up with the title (`uiInSection`).
struct UiSectionView: View {
    let node: UiNode
    let touched: Bool
    let context: UiRenderContext
    var touch: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.uiInSection) private var inSection

    var body: some View {
        let key = "section:\(node.id)"
        let open = context.local.flag(key) ?? node.bool("open") ?? !touched
        let badge = node.string("badge") ?? ""
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
                    if !badge.isEmpty { UiPill(text: badge, tone: node.tone ?? .neutral) }
                }
                .padding(.horizontal, UiTileStyle.padding).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(
                [
                    open ? String(localized: "Expanded") : String(localized: "Collapsed"),
                    badge.isEmpty ? "" : UiToneStyle.word(node.tone),
                ]
                    .filter { !$0.isEmpty }.joined(separator: ", "))
            if open {
                UiNodesView(nodes: node.children, parent: "Section", context: context, spacing: 12)
                    .environment(\.uiInSection, true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, UiTileStyle.padding).padding(.bottom, UiTileStyle.padding)
            }
        }
        .background(
            inSection ? UiTileStyle.inset : UiTileStyle.tile, in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
    }
}

/// The widths of a block from which it holds more than one column, as the desktop's `@min-[420px]` and
/// `@min-[640px]`.
enum UiBlockWidth {
    static let two: CGFloat = 420
    static let three: CGFloat = 640
}

/// Children in as many columns as the block's width holds, which is one on a phone held upright: the block decides,
/// not the screen, since a chat can be any width.
struct UiColumnsLayout<Content: View>: View {
    var spacing: CGFloat = 8
    let columns: (CGFloat) -> Int
    @ViewBuilder let content: () -> Content
    @State private var width: CGFloat = 0

    var body: some View {
        let count = max(1, columns(width))
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: spacing, alignment: .top), count: count),
            alignment: .leading, spacing: spacing, content: content
        )
        .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
    }
}

/// The one component that divides the width: its panes stand side by side and stack in a narrow block.
struct UiColumnsView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let panes = node.children(of: "Pane").count
        UiColumnsLayout(spacing: 12, columns: { $0 >= UiBlockWidth.two ? min(3, max(2, panes)) : 1 }) {
            ForEach(node.children.filter { !$0.isText }) { child in
                UiNodeView(node: child, parent: node.type, context: context)
            }
        }
    }
}

/// Stacks its children as a tab does, under a small title where it has one.
struct UiPaneView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title = node.string("title"), !title.isEmpty {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(MobileStyle.muted)
                    .padding(.horizontal, 2).accessibilityAddTraits(.isHeader)
            }
            UiNodesView(nodes: node.children, parent: "Pane", context: context, spacing: 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
