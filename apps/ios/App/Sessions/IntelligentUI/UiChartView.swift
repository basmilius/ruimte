import Charts
import SwiftUI

/// Up to six series of at most sixty rows, in the chart colors from the accent on. The chart draws only once its
/// node closed and holds its height until then; it grows once, unless a person asked for less motion. What it
/// leaves out or draws otherwise is said under it, with every value a press away. VoiceOver hears one sentence with
/// the main point and finds every value in the chart details and the value list.
struct UiChartView: View {
    let node: UiNode
    let context: UiRenderContext
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grown = false
    @ScaledMetric(relativeTo: .footnote) private var rowHeight: CGFloat = 28
    @ScaledMetric(relativeTo: .footnote) private var stackedRowHeight: CGFloat = 32
    @ScaledMetric(relativeTo: .footnote) private var plotHeight: CGFloat = 160

    private static let colors: [Color] = [
        MobileStyle.accent, MobileStyle.chart2, MobileStyle.chart3, MobileStyle.chart4, MobileStyle.chart5,
        MobileStyle.chart6,
    ]

    private struct Point: Identifiable {
        let id: String
        let label: String
        let series: String
        let value: Double
    }

    var body: some View {
        if !node.complete {
            RoundedRectangle(cornerRadius: 12).fill(MobileStyle.hover)
                .frame(height: height(node.string("kind") ?? "bar", rows: node.props["data"]?.arrayValue?.count ?? 1))
                .padding(.horizontal, 8).accessibilityHidden(true)
        } else if let chart = UiChartData(node) {
            let unit = node.string("unit")
            let summary = Self.summary(chart, unit: unit)
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 8) {
                    plot(chart, kind: chart.kind, unit: unit).frame(
                        height: height(chart.kind, rows: chart.labels.count))
                    if chart.series.count > 1 { legend(chart) }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(summary)
                .accessibilityChartDescriptor(
                    UiChartDescriptor(chart: chart, unit: unit, summary: summary, line: chart.kind == "line")
                )
                .modifier(UiChartValues(values: chart.values, unit: unit))
                notes(chart, unit: unit)
            }
            .padding(.horizontal, 8)
            .onAppear {
                guard !grown else { return }
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.4)) { grown = true }
            }
        } else {
            UiFallbackPart(fallback: node.fallback, problem: .failed)
        }
    }

    private func height(_ kind: String, rows: Int) -> CGFloat {
        let count = CGFloat(min(max(1, rows), UiChartData.maxRows))
        return switch kind {
        case "hbar": count * rowHeight
        case "stacked": count * stackedRowHeight
        default: plotHeight
        }
    }

    /// What the drawing leaves out or draws otherwise, in words, and every value behind a button when it left some out.
    @ViewBuilder private func notes(_ chart: UiChartData, unit: String?) -> some View {
        let requested = node.string("kind") ?? "bar"
        let lines =
            (chart.truncated
                ? [
                    String(
                        localized:
                            "Showing \(UiFormat.number(Double(chart.labels.count))) of \(UiFormat.number(Double(chart.total))) rows."
                    )
                ] : [])
            + (chart.omitted.isEmpty
                ? []
                : [
                    String(localized: "\(chart.omitted.joined(separator: ", ")) not shown.")
                ])
            + (requested == "stacked" && chart.kind != "stacked"
                ? [String(localized: "Negative values cannot stack. Series shown side by side.")] : [])
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(lines, id: \.self) { Text($0) }
            }
            .font(.caption).foregroundStyle(MobileStyle.muted)
        }
        if chart.truncated || !chart.omitted.isEmpty {
            let shown = context.local.flag("chart:\(node.id)") == true
            Button(shown ? String(localized: "Hide values") : String(localized: "Show all values")) {
                context.local.setFlag("chart:\(node.id)", !shown)
            }
            .font(.footnote.weight(.medium)).buttonStyle(.bordered).tint(MobileStyle.text)
            .frame(minHeight: 44)
            if shown { UiChartValuesTable(values: chart.values, unit: unit) }
        }
    }

    private func plot(_ chart: UiChartData, kind: String, unit: String?) -> some View {
        let points = chart.series.flatMap { series in
            series.values.enumerated().compactMap { index, value in
                value.map {
                    Point(id: "\(series.key)\n\(index)", label: chart.labels[index], series: series.key, value: $0)
                }
            }
        }
        let scale = grown || reduceMotion ? 1.0 : 0.0
        // UiChartData only holds data whose range is finite.
        let domain = UiChartData.range(chart.min, chart.max) ?? chart.min...chart.max
        let horizontal = kind == "hbar" || kind == "stacked"
        return Chart(points) { point in
            let value = point.value * scale
            switch kind {
            case "hbar":
                BarMark(x: .value("Value", value), y: .value("Label", point.label))
                    .foregroundStyle(by: .value("Series", point.series))
                    .position(by: .value("Series", point.series))
                    .cornerRadius(3)
            case "stacked":
                BarMark(x: .value("Value", value), y: .value("Label", point.label))
                    .foregroundStyle(by: .value("Series", point.series))
            case "line":
                LineMark(x: .value("Label", point.label), y: .value("Value", value))
                    .foregroundStyle(by: .value("Series", point.series))
                    .interpolationMethod(.monotone)
                if chart.labels.count <= 30 {
                    PointMark(x: .value("Label", point.label), y: .value("Value", value))
                        .foregroundStyle(by: .value("Series", point.series)).symbolSize(16)
                }
            default:
                BarMark(x: .value("Label", point.label), y: .value("Value", value))
                    .foregroundStyle(by: .value("Series", point.series))
                    .position(by: .value("Series", point.series))
                    .cornerRadius(3)
            }
        }
        .chartForegroundStyleScale(
            domain: chart.series.map(\.key), range: Array(Self.colors.prefix(chart.series.count))
        )
        .chartLegend(.hidden)
        .modifier(UiChartScale(horizontal: horizontal, domain: domain))
        .chartXAxis {
            if horizontal { valueMarks(unit: unit) } else { labelMarks() }
        }
        .chartYAxis {
            if horizontal { labelMarks() } else { valueMarks(unit: unit) }
        }
    }

    private func valueMarks(unit: String?) -> some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(MobileStyle.border)
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(UiFormat.withUnit(UiFormat.number(number), unit)).font(.caption)
                        .foregroundStyle(MobileStyle.faint)
                }
            }
        }
    }

    private func labelMarks() -> some AxisContent {
        AxisMarks { _ in
            AxisValueLabel().font(.caption).foregroundStyle(MobileStyle.faint)
        }
    }

    private func legend(_ chart: UiChartData) -> some View {
        UiFlowLayout(spacing: 12) {
            ForEach(Array(chart.series.enumerated()), id: \.element.key) { index, series in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(Self.colors[index]).frame(width: 8, height: 8)
                    Text(series.key).font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
        }
        .accessibilityHidden(true)
    }

    /// One sentence with the main point, which VoiceOver reads in place of the drawing.
    private static func summary(_ chart: UiChartData, unit: String?) -> String {
        guard let top = chart.top else { return String(localized: "Values") }
        let value = UiFormat.withUnit(UiFormat.number(top.value), unit)
        return chart.series.count > 1
            ? String(
                localized: "\(chart.values.labels.count) categories, highest \(top.series) for \(top.label) at \(value)"
            )
            : String(localized: "\(chart.values.labels.count) values, highest \(top.label) at \(value)")
    }
}

private struct UiChartScale: ViewModifier {
    let horizontal: Bool
    let domain: ClosedRange<Double>

    func body(content: Content) -> some View {
        if horizontal {
            content.chartXScale(domain: domain)
        } else {
            content.chartYScale(domain: domain)
        }
    }
}

/// Every row's values as custom content, the list VoiceOver offers under More Content, drawn or not.
private struct UiChartValues: ViewModifier {
    let values: UiChartData.Values
    let unit: String?

    func body(content: Content) -> some View {
        values.labels.indices.reduce(AnyView(content)) { view, index in
            let texts = values.series.compactMap { series in
                series.values[index].map {
                    let value = UiFormat.withUnit(UiFormat.number($0), unit)
                    return values.series.count > 1 ? "\(series.key) \(value)" : value
                }
            }
            return AnyView(
                view.accessibilityCustomContent(
                    Text(verbatim: values.labels[index]), Text(verbatim: texts.joined(separator: ", "))))
        }
    }
}

/// Every number of the data as rows under the chart, once a person asks for them.
private struct UiChartValuesTable: View {
    let values: UiChartData.Values
    let unit: String?
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow {
                    Text(verbatim: "")
                    ForEach(values.series, id: \.key) { series in
                        Text(series.key).font(.footnote.weight(.medium)).foregroundStyle(MobileStyle.muted)
                            .gridColumnAlignment(.trailing)
                    }
                }
                .accessibilityAddTraits(.isHeader)
                ForEach(values.labels.indices, id: \.self) { index in
                    GridRow {
                        Text(values.labels[index]).foregroundStyle(MobileStyle.muted).lineLimit(3)
                            .frame(maxWidth: 200, alignment: .leading)
                        ForEach(values.series, id: \.key) { series in
                            Text(series.values[index].map { UiFormat.withUnit(UiFormat.number($0), unit) } ?? "")
                                .monospacedDigit().foregroundStyle(MobileStyle.text)
                        }
                    }
                    .font(.footnote)
                }
            }
            .padding(10)
            .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { contentHeight = $0 }
        }
        .scrollBounceBehavior(.basedOnSize, axes: [.horizontal, .vertical])
        .frame(height: min(320, max(36, contentHeight)))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
    }
}

private struct UiChartDescriptor: AXChartDescriptorRepresentable {
    let chart: UiChartData
    let unit: String?
    let summary: String
    let line: Bool

    func makeChartDescriptor() -> AXChartDescriptor {
        let unit = unit
        let labels = AXCategoricalDataAxisDescriptor(title: String(localized: "Label"), categoryOrder: chart.labels)
        let values = AXNumericDataAxisDescriptor(
            title: String(localized: "Values"), range: chart.min...chart.max, gridlinePositions: []
        ) { UiFormat.withUnit(UiFormat.number($0), unit) }
        let series = chart.series.map { series in
            AXDataSeriesDescriptor(
                name: series.key, isContinuous: line,
                dataPoints: series.values.enumerated().compactMap { index, value in
                    value.map { AXDataPoint(x: chart.labels[index], y: $0) }
                })
        }
        return AXChartDescriptor(
            title: summary, summary: nil, xAxis: labels, yAxis: values, additionalAxes: [], series: series)
    }
}
