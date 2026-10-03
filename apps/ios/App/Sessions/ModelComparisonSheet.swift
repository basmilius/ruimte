import Charts
import RuimtePulsar
import SwiftUI

/// Compare models: the Intelligence Index against the cost per task, a line per model with a point per effort, as
/// the desktop's models dialog draws it. A tap on a point gives its values, a tap on a model in the list hides it.
struct ModelComparisonSheet: View {
    @State private var comparison = ModelComparisonModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch comparison.load {
                case .loading:
                    MobileLoadingRow("Loading benchmarks")
                case .failed(let unavailable):
                    ContentUnavailableView {
                        Label("No comparison", lucideIcon: "chart-spline", iconSize: 48)
                    } description: {
                        Text(
                            unavailable
                                ? "There are no benchmarks to show yet."
                                : "The benchmarks could not be loaded. Check the connection and try again.")
                    } actions: {
                        Button("Try again") { Task { await comparison.reload() } }
                    }
                case .ready(let result, let receivedAt):
                    content(result, receivedAt: receivedAt)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Compare models")
            .navigationSubtitle("Intelligence against cost")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .task { await comparison.reload() }
    }

    private func content(_ result: ModelBenchmarksResult, receivedAt: Date) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Cost axis").font(.footnote).foregroundStyle(MobileStyle.muted)
                    Spacer()
                    Picker("Cost axis", selection: $comparison.scale) {
                        ForEach(ModelComparisonModel.Scale.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
                if comparison.drawn.isEmpty {
                    Text("Turn on a model in the list to draw it.")
                        .font(.footnote).foregroundStyle(MobileStyle.muted)
                        .frame(maxWidth: .infinity, minHeight: 220)
                } else {
                    ModelComparisonChart(comparison: comparison).frame(height: 240)
                }
                ModelComparisonLegend(comparison: comparison)
                HStack(spacing: 8) {
                    Capsule().stroke(MobileStyle.muted, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                        .frame(width: 14, height: 1.5)
                        .accessibilityHidden(true)
                    Text("Not beaten on both axes").frame(maxWidth: .infinity, alignment: .leading)
                    Toggle("Legacy", isOn: $comparison.showLegacy).fixedSize()
                }
                .font(.footnote).foregroundStyle(MobileStyle.muted)
                HStack(spacing: 6) {
                    Link("Source: Artificial Analysis", destination: ModelComparison.sourceURL).underline()
                    Text("·").accessibilityHidden(true)
                    Text(ModelComparison.updated(fetchedAt: result.fetchedAt, now: receivedAt))
                }
                .font(.caption).foregroundStyle(MobileStyle.faint)
                .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
        }
    }
}

private struct ModelComparisonChart: View {
    @Bindable var comparison: ModelComparisonModel
    private static let shapes: [BasicChartSymbolShape] = [
        .circle, .square, .triangle, .diamond, .pentagon, .cross, .plus, .asterisk,
    ]

    var body: some View {
        let points = comparison.points
        let frontier = ModelComparison.frontier(points.map(\.point))
        let costs = points.map(\.point.costPerTask)
        let ticks = ModelComparison.logTicks(costs)
        let shapes = ModelComparison.shapeIndexes(comparison.listed, shapes: Self.shapes.count)
        Chart {
            ForEach(Array(frontier.enumerated()), id: \.offset) { _, point in
                LineMark(
                    x: .value("Cost per task", point.costPerTask), y: .value("Intelligence", point.intelligence),
                    series: .value("Line", "frontier")
                )
                .foregroundStyle(MobileStyle.text.opacity(0.3))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
            ForEach(points) { item in
                LineMark(
                    x: .value("Cost per task", item.point.costPerTask),
                    y: .value("Intelligence", item.point.intelligence),
                    series: .value("Line", item.model.id)
                )
                .foregroundStyle(ModelComparisonColors.of(item.model.provider))
                .lineStyle(StrokeStyle(lineWidth: 2))
                PointMark(
                    x: .value("Cost per task", item.point.costPerTask),
                    y: .value("Intelligence", item.point.intelligence)
                )
                .foregroundStyle(ModelComparisonColors.of(item.model.provider))
                .symbol(Self.shapes[shapes[item.model.id] ?? 0])
                .symbolSize(40)
                .accessibilityLabel("\(item.model.name), \(ModelComparison.effortLabel(item.point.effort))")
                .accessibilityValue(
                    "Intelligence Index \(ModelComparison.intelligence(item.point.intelligence)), "
                        + "\(ModelComparison.cost(item.point.costPerTask)) per task")
            }
            if let selected = comparison.selected {
                PointMark(
                    x: .value("Cost per task", selected.point.costPerTask),
                    y: .value("Intelligence", selected.point.intelligence)
                )
                .symbol(.circle)
                .symbolSize(180)
                .foregroundStyle(.clear)
                .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(selected.model.name) · \(ModelComparison.effortLabel(selected.point.effort))")
                            .font(.caption.weight(.semibold))
                        Text(
                            "\(ModelComparison.intelligence(selected.point.intelligence)) · "
                                + "\(ModelComparison.cost(selected.point.costPerTask)) per task"
                        )
                        .font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                    .padding(.horizontal, 9).padding(.vertical, 5)
                    .background(MobileStyle.active, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .modifier(CostScale(scale: comparison.scale, ticks: ticks, costs: costs))
        .chartYScale(domain: ModelComparison.intelligenceDomain(points.map(\.point.intelligence)))
        .chartYAxis {
            AxisMarks(position: .leading) { _ in
                AxisGridLine().foregroundStyle(MobileStyle.text.opacity(0.06))
                AxisValueLabel().foregroundStyle(MobileStyle.faint)
            }
        }
        .chartLegend(.hidden)
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onTapGesture { location in select(at: location, proxy: proxy, geometry: geometry) }
            }
        }
        .accessibilityLabel("Intelligence Index against cost per task in USD")
    }

    private func select(at location: CGPoint, proxy: ChartProxy, geometry: GeometryProxy) {
        guard let plot = proxy.plotFrame else { return }
        let frame = geometry[plot]
        let points = comparison.points
        let spots = points.map { item in
            CGPoint(
                x: frame.minX + (proxy.position(forX: item.point.costPerTask) ?? -.greatestFiniteMagnitude),
                y: frame.minY + (proxy.position(forY: item.point.intelligence) ?? -.greatestFiniteMagnitude))
        }
        let index = ModelComparison.nearest(spots, to: location, reach: 28)
        comparison.selected = index.map { points[$0] }
    }
}

/// Decades on a log axis, round steps on a linear one, each labeled in dollars.
private struct CostScale: ViewModifier {
    let scale: ModelComparisonModel.Scale
    let ticks: [Double]
    let costs: [Double]

    func body(content: Content) -> some View {
        switch scale {
        case .log:
            content
                .chartXScale(domain: (ticks.first ?? 0.01)...(ticks.last ?? 1), type: .log)
                .chartXAxis { marks(values: ticks) }
        case .linear:
            content
                .chartXScale(domain: 0...max(0.01, (costs.max() ?? 1) * 1.08), type: .linear)
                .chartXAxis { marks(values: .automatic(desiredCount: 4)) }
        }
    }

    private func marks(values: some Sequence<Double>) -> some AxisContent {
        AxisMarks(values: Array(values)) { value in
            AxisGridLine().foregroundStyle(MobileStyle.text.opacity(0.06))
            AxisValueLabel {
                if let cost = value.as(Double.self) { Text(ModelComparison.cost(cost)) }
            }
            .foregroundStyle(MobileStyle.faint)
        }
    }

    private func marks(values: AxisMarkValues) -> some AxisContent {
        AxisMarks(values: values) { value in
            AxisGridLine().foregroundStyle(MobileStyle.text.opacity(0.06))
            AxisValueLabel {
                if let cost = value.as(Double.self) { Text(ModelComparison.cost(cost)) }
            }
            .foregroundStyle(MobileStyle.faint)
        }
    }
}

/// The list under the chart is its legend: a tap draws a model or takes it away.
private struct ModelComparisonLegend: View {
    @Bindable var comparison: ModelComparisonModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(ModelComparison.providers, id: \.self) { provider in
                let models = comparison.listed.filter { $0.provider == provider }
                if !models.isEmpty {
                    Text(usageProviderName(provider))
                        .font(.caption.weight(.medium)).foregroundStyle(MobileStyle.muted)
                        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 2)
                    ForEach(models, id: \.id) { model in row(model) }
                }
            }
        }
        .padding(.bottom, 4)
        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 16))
    }

    private func row(_ model: BenchmarkModel) -> some View {
        let measured = !model.points.isEmpty
        let shown = measured && !comparison.hidden.contains(model.id)
        return Button {
            comparison.toggle(model.id)
        } label: {
            HStack(spacing: 9) {
                Capsule().fill(shown ? ModelComparisonColors.of(model.provider) : MobileStyle.faint)
                    .frame(width: 14, height: 3)
                Text(model.name).foregroundStyle(shown ? MobileStyle.text : MobileStyle.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(ModelComparison.effortRange(model) ?? "Not measured")
                    .font(.caption).foregroundStyle(MobileStyle.muted)
            }
            .font(.subheadline)
            .padding(.horizontal, 12).frame(minHeight: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(ChatComposerButtonStyle())
        .disabled(!measured)
        .accessibilityAddTraits(shown ? .isSelected : [])
        .accessibilityHint(shown ? "Hides this model in the chart" : "Shows this model in the chart")
    }
}

private enum ModelComparisonColors {
    static func of(_ provider: String) -> Color {
        provider == "codex" ? MobileStyle.chartCodex : MobileStyle.chartClaude
    }
}
