import CoreGraphics
import Foundation
import RuimtePulsar
import Testing

@testable import Ruimte

@Suite struct CanvasRenderTests {
    @Test func arcAndRelativeCommandsKeepTheirEndpoints() throws {
        let path = try SVGPathParser.parse("M10 20 h40 v20 l-10 5 A20 10 30 0 1 90 60 q10 20 30 10 t20 -10")
        #expect(path.currentPoint == CGPoint(x: 140, y: 60))
        #expect(path.boundingBoxOfPath.minX == 10)
        #expect(path.boundingBoxOfPath.maxX >= 140)
    }
    @Test func pairingLinksRequireHTTPSAndKeepTokenOutOfRequestURL() throws {
        let link = try SecurePairingLink("https://machine.example/pair#one-time")
        #expect(link.endpoint.absoluteString == "https://machine.example/auth/pair")
        #expect(link.token == "one-time")
        for invalid in [
            "http://host/pair#t", "https://user:pass@host/pair#t", "https://host/pair", "https://host/other#t",
            "https://host/pair?other=1#t",
        ] {
            #expect(throws: (any Error).self) { try SecurePairingLink(invalid) }
        }
    }
    @Test func malformedCommandsAreRejected() {
        for source in ["L1 2", "M0 0 R2 3", "M1", "M0 0 A5 5 0 2 0 10 10", "M0 0 Z 3 4", "M0 0 L1e400 5"] {
            #expect(throws: (any Error).self) { try SVGPathParser.parse(source) }
        }
    }
    @Test func tinyArcRadiiAndDistancesStayFinite() throws {
        for source in ["M0 0 A1e-300 1e-300 0 0 1 100 100", "M0 0 A100 100 0 0 1 1e-300 0"] {
            let path = try SVGPathParser.parse(source)
            #expect(path.currentPoint.x.isFinite && path.currentPoint.y.isFinite)
            #expect(path.boundingBoxOfPath.width.isFinite)
        }
    }
    @Test func ellipticalArcBoundsMatchHalfEllipse() throws {
        let path = try SVGPathParser.parse("M0 20 A40 20 0 0 1 80 20")
        let box = path.boundingBoxOfPath
        #expect(abs(box.minX) < 0.001)
        #expect(abs(box.maxX - 80) < 0.001)
        #expect(abs(box.minY) < 0.001)
        #expect(abs(box.maxY - 20) < 0.001)
        #expect(path.currentPoint == CGPoint(x: 80, y: 20))
    }
    @Test func removalCleansLinksAndGroupsWithoutChangingOtherFrames() throws {
        let canvas = try JSONValue.decode(
            Data(
                #"{"nodes":[{"id":"a","kind":"chat","x":1},{"id":"b","kind":"group","memberIds":["a","c"]},{"id":"c","kind":"note","x":50,"y":40}],"edges":[{"id":"ab","from":"a","to":"b"},{"id":"bc","from":"b","to":"c"}],"layouts":[{"name":"work","nodes":{"a":{"x":1},"c":{"x":50}},"texts":{}}],"texts":[]}"#
                    .utf8))
        let result = canvasWithoutNode(canvas, id: "a")
        #expect(result.list("nodes").map(\.stableID) == ["b", "c"])
        #expect(result.list("nodes")[0].list("memberIds") == [.string("c")])
        #expect(result.list("nodes")[1] == canvas.list("nodes")[2])
        #expect(result.list("edges").map(\.stableID) == ["bc"])
        #expect(result.list("layouts")[0]["nodes"]?["a"] == nil)
    }
}
