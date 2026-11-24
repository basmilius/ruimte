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

/// The arrow and the sign say which way a value went; only a tone says whether that is good. The change stands at
/// the end of the value's line, and VoiceOver hears what it changed from. A value in words stands as written.
struct UiStatView: View {
    let node: UiNode
    /// The live read that last changed the value, which lights it once.
    var lit: Int? = nil

    var body: some View {
        if let figure = UiStatFigure(node) {
            let ink = UiToneStyle.color(node.tone ?? .neutral)
            VStack(alignment: .leading, spacing: 6) {
                Text(node.string("label") ?? "").font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(figure.value)
                        .font(.title3.weight(.semibold)).modifier(UiLit(read: lit, base: MobileStyle.text))
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                    if let unit = figure.unit {
                        Text(unit).font(.subheadline).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if let change = figure.change {
                        HStack(spacing: 2) {
                            Image(lucide: Self.arrow(change.direction), size: 12)
                            Text(change.text).lineLimit(1)
                        }
                        .font(.caption.weight(.semibold)).monospacedDigit().foregroundStyle(ink).fixedSize()
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(change.said)
                    }
                }
                if let trend = trend {
                    UiTrendLine(points: UiTrend.points(trend))
                        .stroke(ink, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        .frame(height: 24)
                        .accessibilityElement()
                        .accessibilityLabel(
                            String(localized: "Trend from \(reading(trend[0])) to \(reading(trend[trend.count - 1]))"))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .uiTile()
            .accessibilityElement(children: .combine)
        } else {
            UiFallbackPart(fallback: node.fallback, problem: .failed)
        }
    }

    private var trend: [Double]? {
        guard let values = node.props["trend"]?.arrayValue?.compactMap(\.numberValue), values.count >= 2,
            values.allSatisfy(\.isFinite)
        else { return nil }
        return values
    }

    private func reading(_ value: Double) -> String {
        UiFormat.withUnit(UiFormat.number(value), node.string("unit"))
    }

    private static func arrow(_ direction: UiStatFigure.Direction) -> String {
        switch direction {
        case .up: "arrow-up"
        case .down: "arrow-down"
        case .level: "arrow-right"
        }
    }
}

/// One line through the points of `UiTrend`, with room above and below so its round ends are not cut.
private struct UiTrendLine: Shape {
    let points: [CGPoint]

    func path(in rect: CGRect) -> Path {
        let inset = rect.insetBy(dx: 1, dy: 2)
        var path = Path()
        for (index, point) in points.enumerated() {
            let place = CGPoint(x: inset.minX + point.x * inset.width, y: inset.minY + point.y * inset.height)
            if index == 0 { path.move(to: place) } else { path.addLine(to: place) }
        }
        return path
    }
}

extension EnvironmentValues {
    /// Set by an EntityList that draws tiles, whose entries stand as tiles of their own.
    @Entry fileprivate var uiEntityTiles = false
}

/// Tiles side by side up to four entries and names and values on one tile from five, unless `layout` says which.
/// A list draws a hairline between its rows from seven on.
struct UiEntityListView: View {
    let node: UiNode
    let context: UiRenderContext

    private static let tiledUpTo = 4
    private static let dividedFrom = 7

    var body: some View {
        let entries = node.children.filter { !$0.isText }
        let count = node.children(of: "Entry").count
        if node.string("layout").map({ $0 == "tiles" }) ?? (count <= Self.tiledUpTo) {
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

/// A labeled fact. With `as` its value is drawn as a table cell of that kind; text the kind cannot read stays as
/// written.
struct UiEntryView: View {
    let node: UiNode
    let context: UiRenderContext
    @Environment(\.uiEntityTiles) private var tiled

    var body: some View {
        Group {
            if tiled {
                VStack(alignment: .leading, spacing: 2) {
                    Text(node.string("label") ?? "").font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    value.font(.footnote.weight(.semibold)).foregroundStyle(MobileStyle.text)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .uiTile(vertical: 8)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(node.string("label") ?? "").font(.footnote).foregroundStyle(MobileStyle.muted)
                        .frame(minWidth: 72, alignment: .leading)
                    value.font(.subheadline).foregroundStyle(MobileStyle.text).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 28)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var value: some View {
        if let typed = UiTableCell.of(entry: node) {
            UiCellContent(cell: typed.cell, column: typed.column)
        } else {
            UiNodesView(nodes: node.children, parent: node.type, context: context)
        }
    }
}

struct UiCellContent: View {
    let cell: UiTableCell
    let column: UiTableColumn

    var body: some View {
        switch cell {
        case .empty: Text(verbatim: "")
        case .text(let text): Text(text)
        case .number, .date: Text(cell.text(column: column)).monospacedDigit()
        // A path in a cell has no node the daemon can resolve, so it never opens and stays text.
        case .file(let path):
            Text(path).font(.system(.footnote, design: .monospaced)).foregroundStyle(MobileStyle.muted)
        case .tag(let text): UiPill(text: text, tone: column.tones[text] ?? .neutral)
        }
    }
}

/// Rows under a head that stays in place, scrolling inside 320 points and sideways when wider than the card. Rows
/// arrive one by one while the block streams, without animation; past fifty a person asks for the rest. A head
/// sorts by its column, from the order `sort` asked for until a person picks one.
struct UiTableView: View {
    let node: UiNode
    let context: UiRenderContext
    @State private var widths: [String: CGFloat] = [:]
    @State private var contentHeight: CGFloat = 0
    @Environment(\.uiInSection) private var inSection

    private var sortKey: String { "table-sort:\(node.id)" }

    var body: some View {
        let columns = UiTableColumn.of(node)
        if columns.isEmpty {
            UiFallbackPart(fallback: node.fallback, problem: .failed)
        } else {
            let rows = node.props["rows"]?.arrayValue?.compactMap(\.objectValue) ?? []
            let all = context.local.flag("table:\(node.id)") == true
            let sort = picked(columns) ?? UiTableSort.of(node.string("sort"), columns: columns)
            // A row keeps its place in `rows` whatever the order: live readings address it by that.
            let order =
                sort.flatMap { sort in
                    columns.first { $0.key == sort.key }.map {
                        UiTableSort.order(rows, column: $0, descending: sort.descending)
                    }
                } ?? Array(rows.indices)
            let shown = all ? order : Array(order.prefix(UiTableColumn.rowsShown))
            VStack(alignment: .leading, spacing: 8) {
                ScrollView([.horizontal, .vertical]) {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Section {
                            ForEach(Array(shown.enumerated()), id: \.element) { place, index in
                                row(rows[index], at: index, first: place == 0, columns: columns)
                            }
                        } header: {
                            header(columns, sort: sort)
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

    /// The order a person picked, kept as its direction and its key; nil once the table draws no such column.
    private func picked(_ columns: [UiTableColumn]) -> UiTableSort? {
        guard let stored = context.local.pick(sortKey), let split = stored.firstIndex(of: "\n") else { return nil }
        let key = String(stored[stored.index(after: split)...])
        guard columns.contains(where: { $0.key == key }) else { return nil }
        return UiTableSort(key: key, descending: stored[..<split] == "desc")
    }

    private func header(_ columns: [UiTableColumn], sort: UiTableSort?) -> some View {
        HStack(spacing: 0) {
            ForEach(columns, id: \.key) { column in
                let descending = sort?.key == column.key ? sort?.descending : nil
                Button {
                    context.local.setPick(sortKey, "\(descending == false ? "desc" : "asc")\n\(column.key)")
                } label: {
                    cell(
                        HStack(spacing: 4) {
                            // The arrow stands on the side away from the cells, so a title stays in line with its column.
                            if column.numeric { arrow(descending) }
                            Text(column.title)
                            if !column.numeric { arrow(descending) }
                        }, column: column
                    )
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(descending == nil ? MobileStyle.muted : MobileStyle.text)
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(column.title)
                .accessibilityValue(
                    descending.map { $0 ? String(localized: "Descending") : String(localized: "Ascending") } ?? ""
                )
                .accessibilityHint(String(localized: "Sorts the table by this column"))
                .accessibilityAddTraits(.isHeader)
            }
        }
        .background(UiTileStyle.tile)
    }

    @ViewBuilder private func arrow(_ descending: Bool?) -> some View {
        if let descending {
            Image(lucide: descending ? "arrow-down" : "arrow-up", size: 12).accessibilityHidden(true)
        }
    }

    private func row(_ row: [String: JSONValue], at position: Int, first: Bool, columns: [UiTableColumn])
        -> some View
    {
        let cells = columns.map { UiTableCell.of(row[$0.key], column: $0) }
        return HStack(alignment: .firstTextBaseline, spacing: 0) {
            ForEach(Array(columns.enumerated()), id: \.element.key) { index, column in
                let lit = context.model.lit[UiBlockModel.litKey(nodeID: node.id, row: position, column: column.key)]
                cell(UiCellContent(cell: cells[index], column: column), column: column).font(.footnote)
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
            zip(columns, cells).map { "\($0.title): \($1.text(column: $0))" }.joined(separator: ", "))
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
}
