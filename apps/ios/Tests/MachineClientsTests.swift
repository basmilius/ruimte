import Foundation
import RuimtePulsar
import XCTest

@testable import Ruimte

/// Holds the iPhone's Connected now to the desktop's `machine-clients.ts`: the icon table, the labels and the grouping.
@MainActor final class MachineClientsTests: XCTestCase {
    private func client(_ fields: [String: JSONValue]) -> ConnectedMachineClient {
        var object: [String: JSONValue] = [
            "id": .string("client-1"), "access": .string("account"), "reachability": .string("lan"),
            "connectedAt": .number(1_000), "current": .bool(false),
        ]
        object.merge(fields) { $1 }
        return ConnectedMachineClient(.object(object))
    }

    func testTheIconTableDrawsTheDeviceBeforeTheApp() {
        XCTAssertEqual(client(["access": .string("mcp")]).icon, "plug")
        XCTAssertEqual(client(["access": .string("machine"), "device": .string("phone")]).icon, "server")
        XCTAssertEqual(client(["client": .string("station"), "device": .string("phone")]).icon, "smartphone")
        XCTAssertEqual(client(["client": .string("ios")]).icon, "smartphone")
        XCTAssertEqual(client(["client": .string("ios"), "device": .string("tablet")]).icon, "tablet")
        XCTAssertEqual(client(["client": .string("browser")]).icon, "globe")
        XCTAssertEqual(client(["client": .string("desktop")]).icon, "laptop")
        XCTAssertEqual(client(["client": .string("android"), "device": .string("watch")]).icon, "circle-question-mark")
        XCTAssertEqual(client([:]).icon, "circle-question-mark")
    }

    func testTheLabelsNameEachAppAsTheDesktopDoes() {
        XCTAssertEqual(client(["client": .string("desktop"), "os": .string("macos")]).name, "Ruimte for Mac")
        XCTAssertEqual(client(["client": .string("ios"), "device": .string("tablet")]).name, "iPad")
        XCTAssertEqual(client(["client": .string("station")]).name, "station.ruimte.app")
        XCTAssertEqual(client(["access": .string("mcp"), "label": .string("claude.ai")]).name, "MCP · claude.ai")
        XCTAssertEqual(client([:]).name, "Unknown app")
    }

    func testEqualConnectionsBecomeOneRowWithTheEarliestTime() {
        let groups = ConnectedClientGroup.groups([
            client(["id": .string("a"), "client": .string("desktop"), "connectedAt": .number(5_000)]),
            client([
                "id": .string("b"), "client": .string("desktop"), "connectedAt": .number(2_000), "current": .bool(true),
            ]),
            client(["id": .string("c"), "client": .string("station")]),
        ])
        XCTAssertEqual(groups.map(\.id), ["a", "c"])
        XCTAssertEqual(groups.map(\.count), [2, 1])
        XCTAssertEqual(groups.first?.current, true)
        XCTAssertEqual(groups.first?.connectedAt, Date(timeIntervalSince1970: 2))
        XCTAssertTrue(
            groups[0].detail(now: Date(timeIntervalSince1970: 3_602)).hasPrefix("Unknown version · Local network"))
        XCTAssertTrue(groups[0].detail().hasSuffix("2 connections"))
    }
}
