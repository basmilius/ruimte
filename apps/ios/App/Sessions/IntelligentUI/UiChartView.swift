import Charts
import SwiftUI

/// Up to six series of at most sixty rows, in the chart colors from the accent on. The chart draws only once its
/// node closed and holds its height until then; it grows once, unless a person asked for less motion. VoiceOver
/// hears one sentence with the main point and finds every value in the chart details and the value list.
struct UiChartView: View {
    let node: UiNode
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
        let kind = node.string("kind") ?? "bar"
        let rows = min(max(1, node.props["data"]?.arrayValue?.count ?? 1), UiChartData.maxRows)
        let height =
            switch kind {
            case "hbar": CGFloat(rows) * rowHeight
            case "stacked": CGFloat(rows) * stackedRowHeight
            default: plotHeight
            }
        if !node.complete {
            RoundedRectangle(cornerRadius: 12).fill(MobileStyle.hover).frame(height: height)
                .padding(.horizontal, 8).accessibilityHidden(true)
        } else if let chart = UiChartData(node) {
            let unit = node.string("unit")
            let summary = Self.summary(chart, unit: unit)
            VStack(alignment: .leading, spacing: 8) {
                plot(chart, kind: kind, unit: unit).frame(height: height)
                if chart.series.count > 1 { legend(chart) }
            }
            .padding(.horizontal, 8)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(summary)
            .accessibilityChartDescriptor(
                UiChartDescriptor(chart: chart, unit: unit, summary: summary, line: kind == "line")
            )
            .modifier(UiChartValues(chart: chart, unit: unit))
            .onAppear {
                guard !grown else { return }
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.4)) { grown = true }
            }
        } else {
            UiFallbackPart(fallback: node.fallback, problem: .failed)
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
        let domain = chart.min...(chart.min < 0 ? chart.max : niceCeiling(chart.max))
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

    /// A round number at or above `value`, for the end of an axis: 1, 2, 2.5 or 5 times a power of ten.
    private func niceCeiling(_ value: Double) -> Double {
        guard value > 0 else { return 1 }
        let power = pow(10, floor(log10(value)))
        return ([1, 2, 2.5, 5, 10].first { $0 * power >= value } ?? 10) * power
    }

    /// One sentence with the main point, which VoiceOver reads in place of the drawing.
    private static func summary(_ chart: UiChartData, unit: String?) -> String {
        guard let top = chart.top else { return String(localized: "Values") }
        let value = UiFormat.withUnit(UiFormat.number(top.value), unit)
        return chart.series.count > 1
            ? String(localized: "\(chart.labels.count) categories, highest \(top.series) for \(top.label) at \(value)")
            : String(localized: "\(chart.labels.count) values, highest \(top.label) at \(value)")
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

/// Every row's values as custom content, the list VoiceOver offers under More Content.
private struct UiChartValues: ViewModifier {
    let chart: UiChartData
    let unit: String?

    func body(content: Content) -> some View {
        chart.labels.indices.reduce(AnyView(content)) { view, index in
            let values = chart.series.compactMap { series in
                series.values[index].map {
                    let value = UiFormat.withUnit(UiFormat.number($0), unit)
                    return chart.series.count > 1 ? "\(series.key) \(value)" : value
                }
            }
            return AnyView(
                view.accessibilityCustomContent(
                    Text(verbatim: chart.labels[index]), Text(verbatim: values.joined(separator: ", "))))
        }
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
