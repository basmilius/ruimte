import RuimteIntelligentUI
import RuimtePulsar
import RuimteShared
import SwiftUI

struct UiStatsView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 128), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(node.children.filter { !$0.isText }) { child in
                UiNodeView(node: child, parent: node.type, context: context)
            }
        }
    }
}

/// The arrow and the number say which way a value went; only a tone says whether that is good.
struct UiStatView: View {
    let node: UiNode
    /// The live read that last changed the value, which lights it once.
    var lit: Int? = nil

    var body: some View {
        if let value = node.number("value") {
            let unit = node.string("unit")
            let previous = node.number("previous")
            VStack(alignment: .leading, spacing: 6) {
                Text(node.string("label") ?? "").font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                Text(UiFormat.withUnit(UiFormat.number(value), unit))
                    .font(.title3.weight(.semibold)).modifier(UiLit(read: lit, base: MobileStyle.text)).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.7)
                if let previous {
                    change(value: value, previous: previous, unit: unit)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .uiTile()
            .accessibilityElement(children: .combine)
        } else {
            UiFallbackPart(fallback: node.fallback, problem: .failed)
        }
    }

    private func change(value: Double, previous: Double, unit: String?) -> some View {
        let difference = value - previous
        let from = UiFormat.withUnit(UiFormat.number(previous), unit)
        // A change from zero has no percentage.
        let words =
            previous == 0
            ? String(localized: "from \(from)")
            : String(localized: "\(Format.percent(abs(difference / previous * 100))) from \(from)")
        return HStack(spacing: 4) {
            Image(lucide: difference == 0 ? "arrow-right" : difference > 0 ? "arrow-up" : "arrow-down", size: 12)
                .accessibilityHidden(true)
            Text(words).lineLimit(1)
        }
        .font(.caption).monospacedDigit()
        .foregroundStyle(node.tone.map(UiToneStyle.color) ?? MobileStyle.faint)
    }
}

extension EnvironmentValues {
    /// Set by an EntityList of up to four entries, whose entries stand as tiles of their own.
    @Entry fileprivate var uiEntityTiles = false
}

/// Up to four entries as tiles side by side; more as names and values on one tile a person can select, with a
/// hairline between rows from seven on.
struct UiEntityListView: View {
    let node: UiNode
    let context: UiRenderContext

    private static let tiledUpTo = 4
    private static let dividedFrom = 7

    var body: some View {
        let entries = node.children.filter { !$0.isText }
        let count = node.children(of: "Entry").count
        if count <= Self.tiledUpTo {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], alignment: .leading, spacing: 8) {
                ForEach(entries) { entry in UiNodeView(node: entry, parent: node.type, context: context) }
            }
            .environment(\.uiEntityTiles, true)
        } else {
            let divided = count >= Self.dividedFrom
            VStack(alignment: .leading, spacing: divided ? 0 : 6) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    if divided && index > 0 { Divider().overlay(MobileStyle.border) }
                    UiNodeView(node: entry, parent: node.type, context: context)
                        .padding(.vertical, divided ? 6 : 0)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .uiTile(flat: true, vertical: 8)
        }
    }
}

struct UiEntryView: View {
    let node: UiNode
    let context: UiRenderContext
    @Environment(\.uiEntityTiles) private var tiled

    var body: some View {
        Group {
            if tiled {
                VStack(alignment: .leading, spacing: 2) {
                    Text(node.string("label") ?? "").font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    UiNodesView(nodes: node.children, parent: node.type, context: context)
                        .font(.footnote.weight(.semibold)).foregroundStyle(MobileStyle.text)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .uiTile(vertical: 8)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(node.string("label") ?? "").font(.footnote).foregroundStyle(MobileStyle.muted)
                        .frame(minWidth: 72, alignment: .leading)
                    UiNodesView(nodes: node.children, parent: node.type, context: context)
                        .font(.subheadline).foregroundStyle(MobileStyle.text).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 28)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Rows under a head that stays in place, scrolling inside 320 points and sideways when wider than the card. Rows
/// arrive one by one while the block streams, without animation; past fifty a person asks for the rest.
struct UiTableView: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var widths: [String: CGFloat] = [:]
    @State private var contentHeight: CGFloat = 0
    @Environment(\.uiInSection) private var inSection

    var body: some View {
        let columns = UiTableColumn.of(node)
        if columns.isEmpty {
            UiFallbackPart(fallback: node.fallback, problem: .failed)
        } else {
            let rows = node.props["rows"]?.arrayValue?.compactMap(\.objectValue) ?? []
            let all = context.local.flag("table:\(node.id)") == true
            let shown = all ? rows : Array(rows.prefix(UiTableColumn.rowsShown))
            VStack(alignment: .leading, spacing: 8) {
                ScrollView([.horizontal, .vertical]) {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Section {
                            ForEach(shown.indices, id: \.self) { index in
                                row(shown[index], at: index, columns: columns)
                            }
                        } header: {
                            header(columns)
                        }
                    }
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { contentHeight = $0 }
                }
                .scrollBounceBehavior(.basedOnSize, axes: [.horizontal, .vertical])
                .frame(height: min(320, max(36, contentHeight)))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .padding([.horizontal, .bottom], inSection ? 0 : 6)
                .background(
                    inSection ? Color.clear : UiTileStyle.tile, in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
                if !all && rows.count > UiTableColumn.rowsShown {
                    Button(String(localized: "Show all \(UiFormat.number(Double(rows.count))) rows")) {
                        context.local.setFlag("table:\(node.id)", true)
                    }
                    .buttonStyle(.mobileCapsuleSmall)
                    .frame(minHeight: 44)
                }
            }
        }
    }

    private func header(_ columns: [UiTableColumn]) -> some View {
        HStack(spacing: 0) {
            ForEach(columns, id: \.key) { column in
                cell(Text(column.title), column: column).font(.footnote.weight(.medium))
                    .foregroundStyle(MobileStyle.muted)
            }
        }
        .frame(minHeight: 32)
        .background(UiTileStyle.tile)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func row(_ row: [String: JSONValue], at position: Int, columns: [UiTableColumn]) -> some View {
        let cells = columns.map { UiTableCell.of(row[$0.key], column: $0) }
        let first = position == 0
        return HStack(alignment: .firstTextBaseline, spacing: 0) {
            ForEach(Array(columns.enumerated()), id: \.element.key) { index, column in
                let lit = context.model.lit[UiBlockModel.litKey(nodeID: node.id, row: position, column: column.key)]
                cell(content(cells[index], column: column), column: column).font(.footnote)
                    .fontWeight(index == 0 ? .medium : .regular)
                    .modifier(UiLit(read: lit, base: MobileStyle.text))
            }
        }
        .frame(minHeight: 36)
        .background(UiTileStyle.inset)
        .overlay(alignment: .top) {
            if !first { Rectangle().fill(MobileStyle.border).frame(height: 1) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            zip(columns, cells).map { "\($0.title): \(Self.spoken($1, column: $0))" }.joined(separator: ", "))
    }

    /// Every cell of a column takes the width of the widest one measured so far, so the head lines up with the rows.
    private func cell(_ content: some View, column: UiTableColumn) -> some View {
        content
            .lineLimit(3)
            .frame(maxWidth: 240, alignment: column.numeric ? .trailing : .leading)
            .fixedSize(horizontal: true, vertical: false)
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width in
                if width > widths[column.key] ?? 0 { widths[column.key] = width }
            }
            .frame(width: widths[column.key], alignment: column.numeric ? .trailing : .leading)
            .padding(.horizontal, 10).padding(.vertical, 8)
    }

    @ViewBuilder private func content(_ cell: UiTableCell, column: UiTableColumn) -> some View {
        switch cell {
        case .empty: Text(verbatim: "")
        case .text(let text): Text(text)
        case .number: Text(Self.spoken(cell, column: column)).monospacedDigit()
        case .date(let at): Text(Format.moment(UiFormat.moment(milliseconds: at)))
        // A path in a cell has no node the daemon can resolve, so it never opens and stays text.
        case .file(let path):
            Text(path).font(.system(.footnote, design: .monospaced)).foregroundStyle(MobileStyle.muted)
        case .tag(let text): UiPill(text: text, tone: .neutral)
        }
    }

    private static func spoken(_ cell: UiTableCell, column: UiTableColumn) -> String {
        switch cell {
        case .empty: ""
        case .text(let text), .file(let text), .tag(let text): text
        case .number(let value, let kind):
            switch kind {
            case .bytes: Format.bytes(value)
            case .duration: Format.duration(milliseconds: value)
            default: UiFormat.withUnit(UiFormat.number(value), column.unit)
            }
        case .date(let at): Format.moment(UiFormat.moment(milliseconds: at))
        }
    }
}
