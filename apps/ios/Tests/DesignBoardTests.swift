import XCTest

@testable import Ruimte

final class DesignBoardTests: XCTestCase {
    private let card = CGSize(width: 1200, height: 675)

    func testAWideBoardFitsItsWidthAndStandsInTheMiddle() {
        let camera = DesignBoard.fit(board: CGSize(width: 3312, height: 900), frame: card)
        XCTAssertEqual(camera.zoom, (1200 - 96) / 3312.0, accuracy: 1e-9)
        XCTAssertEqual(camera.x, 48, accuracy: 1e-9)
        XCTAssertEqual(camera.y, (675 - 900 * camera.zoom) / 2, accuracy: 1e-9)
        let extent = DesignBoard.extent(board: CGSize(width: 3312, height: 900), camera: camera)
        XCTAssertEqual(extent.width, 1200, accuracy: 1e-9)
    }

    func testATallBoardStartsAtItsTop() {
        let camera = DesignBoard.fit(board: CGSize(width: 2208, height: 6000), frame: CGSize(width: 402, height: 700))
        XCTAssertEqual(camera.zoom, (402 - 96) / 2208.0, accuracy: 1e-9)
        XCTAssertEqual(camera.y, 48)
    }

    func testANarrowBoardKeepsItsOwnSizeInTheMiddle() {
        let camera = DesignBoard.fit(board: CGSize(width: 600, height: 300), frame: card)
        XCTAssertEqual(camera, DesignBoard.Camera(x: 300, y: 187.5, zoom: 1))
    }

    func testAVeryWideBoardStopsAtTheSmallestZoom() {
        let camera = DesignBoard.fit(board: CGSize(width: 40000, height: 800), frame: CGSize(width: 402, height: 700))
        XCTAssertEqual(camera.zoom, 0.1)
        XCTAssertEqual(camera.x, 48)
        XCTAssertEqual(camera.y, (700 - 80) / 2.0, accuracy: 1e-9)
    }

    func testAPageIsABoardOnlyByTheCanvasMeta() {
        func board(_ html: String) -> Bool { DesignBoard.isBoard(Data(html.utf8)) }
        XCTAssertTrue(board(#"<head><meta name="ruimte-design" content="canvas"></head>"#))
        XCTAssertTrue(board("<HEAD><META CONTENT='canvas' NAME=ruimte-design /></HEAD>"))
        XCTAssertFalse(board(#"<meta name="ruimte-design" content="Canvas">"#))
        XCTAssertFalse(board(#"<meta name="description" content="canvas"><p>ruimte-design</p>"#))
        XCTAssertFalse(board(#"<metadata name="ruimte-design" content="canvas">"#))
        XCTAssertFalse(board("<h1>A page</h1>"))
    }
}
