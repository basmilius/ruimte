import CoreGraphics
import RuimtePulsar
import XCTest

@testable import Ruimte

@MainActor final class ModelComparisonTests: XCTestCase {
    private func point(_ effort: String, _ intelligence: Double, _ cost: Double) -> BenchmarkPoint {
        BenchmarkPoint(effort: effort, intelligence: intelligence, costPerTask: cost)
    }

    private func model(_ id: String, provider: String = "claude", legacy: Bool = false, points: [BenchmarkPoint] = [])
        -> BenchmarkModel
    {
        BenchmarkModel(id: id, name: id.capitalized, provider: provider, legacy: legacy, points: points)
    }

    func testTheFrontierKeepsOnlyPointsNothingBeatsOnBothAxes() {
        let points = [
            point("a", 50, 0.1), point("b", 45, 0.2), point("c", 60, 0.3), point("d", 60, 0.5), point("e", 70, 1),
        ]
        XCTAssertEqual(ModelComparison.frontier(points).map(\.effort), ["a", "c", "e"])
    }

    func testAnUnknownProviderIsLeftOutOfTheChart() {
        let models = [model("one"), model("two", provider: "future"), model("three", provider: "codex")]
        XCTAssertEqual(ModelComparison.chartModels(models).map(\.id), ["one", "three"])
    }

    func testTheLogAxisRunsOverWholeDecades() {
        XCTAssertEqual(ModelComparison.logTicks([0.03, 0.4, 2]), [0.01, 0.1, 1, 10])
        XCTAssertEqual(ModelComparison.logTicks([0.5]), [0.1, 1])
        XCTAssertEqual(ModelComparison.logTicks([]), [0.1, 1, 10])
        XCTAssertEqual(ModelComparison.intelligenceDomain([47, 66]), 40...70)
    }

    func testATapFindsTheNearestPointWithinReach() {
        let spots = [CGPoint(x: 0, y: 0), CGPoint(x: 30, y: 0), CGPoint(x: 100, y: 100)]
        XCTAssertEqual(ModelComparison.nearest(spots, to: CGPoint(x: 20, y: 2), reach: 24), 1)
        XCTAssertNil(ModelComparison.nearest(spots, to: CGPoint(x: 60, y: 60), reach: 24))
    }

    func testCurrentModelsTakeTheFirstShapesOfTheirProvider() {
        let models = [
            model("old", legacy: true), model("new"), model("codex", provider: "codex"), model("newer"),
        ]
        XCTAssertEqual(
            ModelComparison.shapeIndexes(models, shapes: 8), ["new": 0, "newer": 1, "old": 2, "codex": 0])
    }

    func testTheLegendNamesTheEffortsAModelRunsOver() {
        XCTAssertEqual(
            ModelComparison.effortRange(model("a", points: [point("low", 1, 1), point("max", 2, 2)])), "Low to Max")
        XCTAssertEqual(ModelComparison.effortRange(model("b", points: [point("xhigh", 1, 1)])), "Extra high")
        XCTAssertNil(ModelComparison.effortRange(model("c")))
    }

    func testUpdatedSaysHowLongAgoTheNumbersWereRead() {
        let now = Date(timeIntervalSince1970: 100_000)
        XCTAssertEqual(ModelComparison.updated(fetchedAt: 99_990_000, now: now), "Updated just now")
        XCTAssertEqual(ModelComparison.updated(fetchedAt: 99_880_000, now: now), "Updated 2 minutes ago")
        XCTAssertEqual(ModelComparison.updated(fetchedAt: 96_400_000, now: now), "Updated 1 hour ago")
        XCTAssertEqual(ModelComparison.updated(fetchedAt: 0, now: now), "Updated 1 day ago")
    }

    func testHiddenAndLegacyModelsStayOffTheChart() async {
        let result = ModelBenchmarksResult(
            fetchedAt: 0,
            models: [
                model("a", points: [point("low", 50, 0.1)]), model("b", points: [point("low", 55, 0.2)]),
                model("c", legacy: true, points: [point("low", 40, 0.1)]), model("d"),
            ])
        let comparison = ModelComparisonModel(fetch: { result })
        await comparison.reload()
        XCTAssertEqual(comparison.listed.map(\.id), ["a", "b", "d"])
        XCTAssertEqual(comparison.drawn.map(\.id), ["a", "b"])
        comparison.toggle("a")
        XCTAssertEqual(comparison.drawn.map(\.id), ["b"])
        comparison.showLegacy = true
        XCTAssertEqual(comparison.drawn.map(\.id), ["b", "c"])
    }

    func testNoBenchmarksYetIsNotAFailureToReachTheAddressBook() async {
        let empty = ModelComparisonModel(fetch: {
            throw AddressBookRequestError(code: "no-benchmarks", status: 503, message: "")
        })
        await empty.reload()
        XCTAssertEqual(empty.load, .failed(unavailable: true))
        let offline = ModelComparisonModel(fetch: {
            throw AddressBookRequestError(code: "network", status: 0, message: "")
        })
        await offline.reload()
        XCTAssertEqual(offline.load, .failed(unavailable: false))
    }
}
