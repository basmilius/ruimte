import RuimteIntelligentUI
import RuimtePulsar
import SwiftUI
import UIKit

/// One block of a reply as a card in the thread. The model is the block's: the view only draws what it evaluated,
/// changes inputs and sends a choice through it, and tells it when the card is on screen.
struct UiBlockView: View {
    let model: UiBlockModel
    /// Chat, item and block, which keys what a person opened here (a tab, a folded section).
    let localKey: String
    let flash: UUID?
    @State private var highlighted = false
    @AccessibilityFocusState private var focused: Bool
    @Environment(\.uiHost) private var host
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floor: CGFloat = 0
    @State private var streamed: Bool

    init(model: UiBlockModel, localKey: String, flash: UUID? = nil) {
        self.model = model
        self.localKey = localKey
        self.flash = flash
        _streamed = State(initialValue: !model.complete)
    }

    var body: some View {
        let nodes = UiNode.list(model.nodes)
        let shownAsText = UiBlockText.of(
            block: model.block, evaluated: nodes, diagnostics: model.diagnostics, error: model.error)
        let head = UiCatalog.head(nodes)
        let context = UiRenderContext(
            model: model, local: UiBlockLocal.shared(localKey), host: host,
            written: UiCatalog.writtenTexts(model.block["nodes"]?.arrayValue ?? []), headID: head?.id,
            catalogVersion: model.block["catalogVersion"]?.numberValue.map { Int($0) })
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                if shownAsText != nil {
                    MarkdownMessage(text: model.block["fallback"]?.stringValue ?? "").padding(.horizontal, 8)
                } else if nodes.isEmpty && context.streaming {
                    UiSkeleton().padding(.horizontal, 8).padding(.vertical, 4)
                } else {
                    UiNodesView(nodes: nodes, parent: UiNodesView.block, context: context)
                }
            }
            .padding(8)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: nodes.map(\.id))
            UiBlockFooter(context: context, nodes: nodes, shownAsText: shownAsText)
        }
        .frame(maxWidth: .infinity, minHeight: max(44, context.streaming ? floor : 0), alignment: .topLeading)
        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { height in
            if !model.complete { floor = max(floor, height) }
        }
        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 20))
        .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(MobileStyle.border) }
        .overlay {
            if highlighted { RoundedRectangle(cornerRadius: 20).strokeBorder(MobileStyle.accent, lineWidth: 2) }
        }
        .background(UiBlockRevealMarker(flash: flash))
        .accessibilityFocused($focused)
        .task(id: flash) {
            guard flash != nil else { return }
            highlighted = true
            focused = true
            do { try await Task.sleep(for: .seconds(1.6)) } catch {
                highlighted = false
                return
            }
            highlighted = false
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(blockName(head))
        .onAppear { activate() }
        .onDisappear { model.stop() }
        .onChange(of: scenePhase) { activate() }
        .onChange(of: host.connected) { activate() }
        .onChange(of: model.complete) { _, complete in
            activate()
            guard complete else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { floor = 0 }
            if streamed, nodes.contains(where: Self.holdsChoices) {
                AccessibilityNotification.Announcement(String(localized: "Choices are ready")).post()
            }
            streamed = false
        }
        .task(id: linkCheck(nodes)) { await checkLinks(nodes) }
    }

    private func activate() {
        model.setActive(visible: scenePhase == .active, connected: host.connected)
    }

    private func blockName(_ head: UiNode?) -> String {
        let label = head.map { UiCatalog.plainLabel($0.label) } ?? ""
        return label.isEmpty ? String(localized: "Interactive block") : label
    }

    private static func holdsChoices(_ node: UiNode) -> Bool {
        node.type == "Choices" || node.children.contains(where: holdsChoices)
    }

    /// The links a final block shows without a reading yet, such as after an input changed what one points to.
    private func linkCheck(_ nodes: [UiNode]) -> [String] {
        guard model.complete, host.connected, host.open != nil else { return [] }
        var ids: [String] = []
        func visit(_ nodes: [UiNode]) {
            for node in nodes where node.error == nil && node.complete {
                if UiCatalog.links.contains(node.type), model.resolvedLinks[node.id] == nil { ids.append(node.id) }
                visit(node.children)
            }
        }
        visit(nodes)
        return Array(ids.prefix(64))
    }

    /// Asks the daemon once per link whether it is a chip, so a link reads right before anyone taps it; the daemon
    /// checks again at the tap.
    private func checkLinks(_ nodes: [UiNode]) async {
        for id in linkCheck(nodes) {
            guard !Task.isCancelled else { return }
            _ = try? await model.link(nodeID: id)
        }
    }
}

/// The children of one parent. A run of text and inline nodes becomes one paragraph; everything else stands as a
/// row of its own, each node on its own so one that cannot be drawn leaves its siblings alone.
struct UiNodesView: View {
    static let block = "$block"
    private static let paragraphParents: Set<String> = [block, "Tab", "Section"]

    let nodes: [UiNode]
    let parent: String
    let context: UiRenderContext
    var spacing: CGFloat = 10

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            ForEach(groups, id: \.id) { group in
                switch group {
                case .run(let run):
                    if Self.paragraphParents.contains(parent) {
                        UiInlineRun(nodes: run, parent: parent, context: context)
                            .font(.subheadline)
                            .foregroundStyle(parent == "Section" ? MobileStyle.muted : MobileStyle.text)
                            .padding(.horizontal, parent == "Section" ? 0 : 8)
                            .transition(UiMotion.arrival)
                    } else {
                        UiInlineRun(nodes: run, parent: parent, context: context)
                    }
                case .node(let node):
                    UiNodeView(node: node, parent: parent, context: context).transition(UiMotion.arrival)
                }
            }
        }
    }

    private enum Group {
        case run([UiNode])
        case node(UiNode)

        var id: String {
            switch self {
            case .run(let nodes): "run:" + (nodes.first?.id ?? "")
            case .node(let node): node.id
            }
        }
    }

    private var groups: [Group] {
        var output: [Group] = []
        var run: [UiNode] = []
        func close() {
            if run.contains(where: { !$0.isBlankText }) { output.append(.run(run)) }
            run = []
        }
        for node in nodes {
            if UiCatalog.isInline(node) {
                run.append(node)
            } else {
                close()
                output.append(.node(node))
            }
        }
        close()
        return output
    }
}

enum UiMotion {
    /// A node comes in with its opacity and 2 points up, without a stagger: it happens often.
    static var arrival: AnyTransition { AnyTransition.opacity.combined(with: .offset(y: 2)) }
}

/// Picks the renderer by type, or the fallback of the node when this version cannot draw it.
struct UiNodeView: View {
    let node: UiNode
    let parent: String
    let context: UiRenderContext

    var body: some View {
        if let problem = UiFallbackProblem.of(node, catalogVersion: context.catalogVersion) {
            UiFallbackPart(fallback: node.fallback, problem: problem)
        } else {
            renderer
        }
    }

    @ViewBuilder private var renderer: some View {
        switch node.type {
        case "Summary": UiSummaryView(node: node, context: context)
        case "Callout": UiCalloutView(node: node, context: context)
        case "Tag": UiTagView(node: node)
        case "Progress": UiProgressView(node: node, context: context)
        case "Steps": UiStepsView(node: node, context: context)
        case "Step": UiStepView(node: node, context: context)
        case "Stats": UiStatsView(node: node, context: context)
        case "Stat": UiStatView(node: node)
        case "EntityList": UiEntityListView(node: node, context: context)
        case "Entry": UiEntryView(node: node, context: context)
        case "Table": UiTableView(node: node, context: context)
        case "Chart": UiChartView(node: node)
        case "Tabs": UiTabsView(node: node, context: context)
        case "Tab": UiNodesView(nodes: node.children, parent: "Tab", context: context)
        case "Sections": UiSectionsView(node: node, context: context)
        case "Section": UiSectionView(node: node, touched: false, context: context)
        case "CodeBlock": UiCodeBlockView(node: node)
        case "Image": UiImageView(node: node)
        case "Sources": UiSourcesView(node: node, context: context)
        case "Source": UiSourceView(node: node, number: nil, context: context)
        case "File", "Diff", "Commit", "Node": UiLinkRow(node: node, context: context)
        case "Checklist": UiChecklistView(node: node, context: context)
        case "Item": UiItemView(node: node, selected: false, enabled: false, toggle: {}, context: context)
        case "Switch": UiSwitchView(node: node, context: context)
        case "Slider": UiSliderView(node: node, context: context)
        case "Segmented": UiSegmentedView(node: node, context: context)
        case "Button": UiButtonView(node: node, context: context)
        case "Choices": UiChoicesView(node: node, context: context)
        case "Choice": UiChoiceView(node: node, context: context)
        // Column and Option are metadata their parent reads; Show and Each arrive expanded.
        default: EmptyView()
        }
    }
}

/// One part of a block as the Markdown it stands for, with a line that says why. A person reads it as a repair,
/// never as an error, so nothing here is red.
struct UiFallbackPart: View {
    let fallback: String
    let problem: UiFallbackProblem

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Group {
                switch problem {
                case .unknown(let component): Text("This version cannot draw \(component)")
                case .failed: Text("Could not draw this part")
                }
            }
            .font(.caption).foregroundStyle(MobileStyle.faint)
            if !fallback.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                MarkdownMessage(text: fallback).font(.subheadline)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(MobileStyle.hover, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

/// Holds the place of the head until the first node arrives; no words, since the reply already says it writes.
struct UiSkeleton: View {
    var body: some View {
        GeometryReader { geometry in
            Capsule().fill(MobileStyle.hover).frame(width: geometry.size.width * 0.4, height: 12)
        }
        .frame(height: 20)
        .accessibilityHidden(true)
    }
}

/// Lays its children out left to right and wraps to a next line where the width runs out.
struct UiFlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
                subviews[index].place(
                    at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
            if !row.indices.isEmpty && row.width + spacing + size.width > width {
                rows.append(row)
                row = Row()
            }
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

private struct UiBlockRevealMarker: UIViewRepresentable {
    let flash: UUID?
    final class Coordinator { var last: UUID? }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> UIView { UIView() }
    func updateUIView(_ view: UIView, context: Context) {
        guard let flash, flash != context.coordinator.last else { return }
        context.coordinator.last = flash
        DispatchQueue.main.async {
            guard view.window != nil else { return }
            var ancestor = view.superview
            while let parent = ancestor {
                if let collection = parent as? UICollectionView {
                    collection.layoutIfNeeded()
                    collection.scrollRectToVisible(
                        view.convert(view.bounds, to: collection).insetBy(dx: 0, dy: -8),
                        animated: !UIAccessibility.isReduceMotionEnabled)
                    return
                }
                ancestor = parent.superview
            }
        }
    }
}
