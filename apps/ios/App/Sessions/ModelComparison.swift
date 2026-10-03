import CoreGraphics
import Foundation
import Observation
import RuimtePulsar

/// The pure part of Compare models, after `apps/client/src/shell/models/chart.ts`: which models the chart can draw,
/// the points no other point beats, and the words around them.
enum ModelComparison {
    /// The providers the chart has a color for; one the address book knows and this app does not is left out.
    static let providers = ["claude", "codex"]

    /// Where the numbers come from, which the terms of Artificial Analysis ask to name with a link. Those terms allow a
    /// chart and not the data, so the sheet never gets a table or a way to copy the numbers.
    static let sourceURL = URL(string: "https://artificialanalysis.ai")!

    static func chartModels(_ models: [BenchmarkModel]) -> [BenchmarkModel] {
        models.filter { providers.contains($0.provider) }
    }

    /// A model's points in order of cost, which is the order its line runs through them.
    static func line(_ model: BenchmarkModel) -> [BenchmarkPoint] {
        model.points.sorted { $0.costPerTask < $1.costPerTask }
    }

    /// The points no other point beats on both axes: none is at least as cheap and at least as good, and better on
    /// one of the two. In order of cost.
    static func frontier(_ points: [BenchmarkPoint]) -> [BenchmarkPoint] {
        let sorted = points.sorted {
            $0.costPerTask == $1.costPerTask ? $0.intelligence > $1.intelligence : $0.costPerTask < $1.costPerTask
        }
        var kept: [BenchmarkPoint] = []
        var best = -Double.infinity
        for point in sorted where point.intelligence > best {
            kept.append(point)
            best = point.intelligence
        }
        return kept
    }

    /// The decades a log axis runs over, the cheapest effort and the dearest lying three of them apart.
    static func logTicks(_ costs: [Double]) -> [Double] {
        let positive = costs.filter { $0 > 0 }
        let low = positive.min().map { Int(floor(log10($0))) } ?? -1
        let ceiling = positive.max().map { Int(ceil(log10($0))) } ?? 1
        let high = ceiling > low ? ceiling : low + 1
        return (low...high).map { pow(10, Double($0)) }
    }

    /// Steps of ten around the scores, so the lines never touch the edge.
    static func intelligenceDomain(_ values: [Double]) -> ClosedRange<Double> {
        let low = values.min().map { floor($0 / 10) * 10 } ?? 0
        let ceiling = values.max().map { ceil($0 / 10) * 10 } ?? 60
        return low...(ceiling > low ? ceiling : low + 10)
    }

    /// The point closest to a tap within `reach` points, so a finger need not land on a mark exactly.
    static func nearest(_ spots: [CGPoint], to location: CGPoint, reach: CGFloat) -> Int? {
        var nearest: Int?
        var distance = reach
        for (index, spot) in spots.enumerated() {
            let away = hypot(spot.x - location.x, spot.y - location.y)
            if away <= distance {
                distance = away
                nearest = index
            }
        }
        return nearest
    }

    /// Within each provider a shape of its own per model, current models first, so the ones shown by default are the
    /// easiest to tell apart. Past `shapes` models of one provider a shape comes round again.
    static func shapeIndexes(_ models: [BenchmarkModel], shapes: Int) -> [String: Int] {
        var indexes: [String: Int] = [:]
        var used: [String: Int] = [:]
        for model in models.filter({ !$0.legacy }) + models.filter(\.legacy) {
            let index = used[model.provider, default: 0]
            used[model.provider] = index + 1
            indexes[model.id] = index % shapes
        }
        return indexes
    }

    static func effortLabel(_ id: String) -> String {
        switch id {
        case "low": "Low"
        case "medium": "Medium"
        case "high": "High"
        case "xhigh": "Extra high"
        case "max": "Max"
        case "off": "No thinking"
        case "thinking": "Thinking"
        default: id.prefix(1).uppercased() + id.dropFirst()
        }
    }

    /// "Low to High" under a model in the legend, "High" for one effort, nil for a model nobody measured.
    static func effortRange(_ model: BenchmarkModel) -> String? {
        guard let first = model.points.first, let last = model.points.last else { return nil }
        let from = effortLabel(first.effort)
        let to = effortLabel(last.effort)
        return from == to ? from : "\(from) to \(to)"
    }

    static func cost(_ value: Double) -> String {
        value.formatted(.currency(code: "USD").precision(.significantDigits(1...2)))
    }

    static func intelligence(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...1)))
    }

    /// How long ago the address book read the numbers.
    static func updated(fetchedAt: Int64, now: Date) -> String {
        let past = max(0, now.timeIntervalSince1970 - Double(fetchedAt) / 1000)
        let (unit, size): (String, Double) =
            past < 3600 ? ("minute", 60) : past < 86_400 ? ("hour", 3600) : ("day", 86_400)
        let count = Int(past / size)
        if count == 0 { return "Updated just now" }
        return "Updated \(count) \(unit)\(count == 1 ? "" : "s") ago"
    }
}

/// One mark on the chart, with the model it belongs to.
struct ModelComparisonPoint: Identifiable, Equatable {
    let model: BenchmarkModel
    let point: BenchmarkPoint
    var id: String { "\(model.id):\(point.effort)" }
}

/// The comparison sheet's state: asked every time it opens and kept nowhere else, since the numbers are the address
/// book's and it reads them again every few hours.
@MainActor @Observable
final class ModelComparisonModel {
    enum Load: Equatable {
        case loading
        case ready(ModelBenchmarksResult, receivedAt: Date)
        /// `unavailable` when the address book has no numbers yet, which is not a failure to reach it.
        case failed(unavailable: Bool)
    }

    enum Scale: String, CaseIterable {
        case log, linear
        var label: String { self == .log ? "Log" : "Linear" }
    }

    private(set) var load = Load.loading
    var scale = Scale.log
    var hidden: Set<String> = []
    var showLegacy = false
    var selected: ModelComparisonPoint?
    @ObservationIgnored private let fetch: @Sendable () async throws -> ModelBenchmarksResult

    init(fetch: @escaping @Sendable () async throws -> ModelBenchmarksResult = { try await AddressBookClient().modelBenchmarks() }) {
        self.fetch = fetch
    }

    func reload(now: Date = .now) async {
        load = .loading
        do {
            load = .ready(try await fetch(), receivedAt: now)
        } catch let error as AddressBookRequestError {
            load = .failed(unavailable: ["not-configured", "no-benchmarks"].contains(error.code))
        } catch {
            load = .failed(unavailable: false)
        }
    }

    /// Every model the legend lists: legacy ones only while asked for.
    var listed: [BenchmarkModel] {
        guard case .ready(let result, _) = load else { return [] }
        return ModelComparison.chartModels(result.models).filter { showLegacy || !$0.legacy }
    }

    /// The models the chart draws: measured, listed and not turned off.
    var drawn: [BenchmarkModel] { listed.filter { !$0.points.isEmpty && !hidden.contains($0.id) } }

    var points: [ModelComparisonPoint] {
        drawn.flatMap { model in ModelComparison.line(model).map { ModelComparisonPoint(model: model, point: $0) } }
    }

    func toggle(_ id: String) {
        if hidden.contains(id) { hidden.remove(id) } else { hidden.insert(id) }
        if selected?.model.id == id { selected = nil }
    }
}
