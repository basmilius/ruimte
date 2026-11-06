import RuimtePulsar
import XCTest

@testable import Ruimte

final class ModelNameTests: XCTestCase {
    private let models = [
        ProviderWire.model("gpt-5.6-sol", name: "GPT-5.6 Sol").providerModel,
        ProviderWire.model("claude-opus-5", name: "Claude Opus 5").providerModel,
    ]

    func testASlugDropsItsVendorAndDateAndPutsTheVersionBackTogether() {
        XCTAssertEqual(ModelName.fromSlug("claude-opus-4-5"), "Claude Opus 4.5")
        XCTAssertEqual(ModelName.fromSlug("anthropic/claude-fable-5-1"), "Claude Fable 5.1")
        XCTAssertEqual(ModelName.fromSlug("claude-haiku-4-5-20251001"), "Claude Haiku 4.5")
        XCTAssertEqual(ModelName.fromSlug("gpt-5.6-sol"), "GPT 5.6 Sol")
        XCTAssertEqual(ModelName.fromSlug("claude-opus-5"), "Claude Opus 5")
    }

    func testAModelTheCLIOffersIsNamedTheWayItsOwnCatalogWritesIt() {
        XCTAssertEqual(ModelName.of("gpt-5.6-sol", in: models), "GPT-5.6 Sol")
    }

    func testASlugOutsideTheCatalogFallsBackToItsOwnReading() {
        XCTAssertEqual(ModelName.of("gpt-5.5", in: models), "GPT 5.5")
        XCTAssertEqual(ModelName.of("claude-opus-5", in: []), "Claude Opus 5")
    }

    func testAShortNameDropsOnlyTheWholeWordsEveryModelShares() {
        func named(_ name: String) -> ProviderModel { ProviderWire.model("m", name: name).providerModel }
        let claude = [named("Claude Opus 5.5"), named("Claude Sonnet 5")]
        XCTAssertEqual(ModelName.short("Claude Opus 5.5", in: claude), "Opus 5.5")
        XCTAssertEqual(ModelName.short("GPT-6", in: [named("GPT-6"), named("GPT-6 Mini")]), "GPT-6")
        XCTAssertEqual(ModelName.short("Claude Opus 5.5", in: [named("Claude Opus 5.5")]), "Claude Opus 5.5")
    }
}
