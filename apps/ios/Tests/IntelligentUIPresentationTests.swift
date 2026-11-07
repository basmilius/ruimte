import RuimteIntelligentUI
import RuimtePulsar
import SceneKit
import SwiftUI
import UIKit
import XCTest

@testable import Ruimte

final class IntelligentUIPresentationTests: XCTestCase {
    func testChoiceJumpKeepsExactSourceAndRejectsIncompleteOrigins() throws {
        let origin = choice(itemID: "item", blockID: "block", revision: "revision")
        let jump = try XCTUnwrap(UiChoiceJump(origin))
        XCTAssertEqual(jump.itemID, "item")
        XCTAssertEqual(jump.blockID, "block")
        XCTAssertEqual(jump.revision, "revision")
        XCTAssertNotEqual(jump.nonce, UiChoiceJump(origin)?.nonce)
        XCTAssertNil(UiChoiceJump(choice(itemID: "item", blockID: "", revision: "")))
        XCTAssertNil(UiChoiceJump(choice(itemID: "", blockID: "block", revision: "revision")))
        XCTAssertNil(UiChoiceJump(choice(itemID: "item", blockID: "", revision: "revision")))
        XCTAssertNil(UiChoiceJump(choice(itemID: "item", blockID: "block", revision: "")))
    }

    private func choice(itemID: String, blockID: String, revision: String) -> ChatUserItemUiChoice {
        ChatUserItemUiChoice(
            itemId: itemID, blockId: blockID, revision: revision, choiceId: "choice", label: "Yes", sourceAt: 0,
            older: false, at: 0)
    }

    private func node(_ json: String) throws -> UiNode {
        try XCTUnwrap(UiNode(JSONValue.decode(Data(json.utf8))))
    }

    /// A slider bound to `$count` and a summary that reads it, as the daemon compiles them.
    private let sliderBlock = #"""
        {"id":"b","catalogVersion":1,"start":0,"end":117,"complete":true,"defaults":{"$count":2},"queries":{},"revision":"r",
        "diagnostics":[],"fallback":"Count\nTotal 5","nodes":[
        {"id":"b:11","type":"Slider","props":{"min":0,"max":10},"expressions":{"value":{"kind":"reference","name":"$count"}},
        "bindings":{"value":"$count"},"complete":true,"fallback":"Count\n","start":11,"end":66,"children":[
        {"id":"b:52","type":"$text","props":{"text":"Count"},"expressions":{},"bindings":{},"children":[],"complete":true,"fallback":"Count","start":52,"end":57}]},
        {"id":"b:66","type":"Summary","props":{},"expressions":{},"bindings":{},"complete":true,"fallback":"Total\n","start":66,"end":117,"children":[
        {"id":"b:75","type":"$text","props":{"text":"Total "},"expressions":{},"bindings":{},"children":[],"complete":true,"fallback":"Total ","start":75,"end":81},
        {"id":"b:81","type":"$text","props":{},"expressions":{"text":{"kind":"reference","name":"$count"}},"bindings":{},"children":[],"complete":true,"fallback":"2","start":81,"end":107}]}]}
        """#

    func testWrittenTextIsProseAndAnExpressionStaysData() throws {
        let block = try JSONValue.decode(Data(sliderBlock.utf8))
        XCTAssertEqual(UiCatalog.writtenTexts(block["nodes"]?.arrayValue ?? []), ["b:52", "b:75"])
    }

    func testAComponentFromANewerDaemonFallsBackAloneBesideItsSiblings() throws {
        let calendar = try node(
            #"{"id":"m","type":"Calendar","props":{"days":[]},"fallback":"Mon\nTue"}"#)
        let flagged = try node(
            #"{"id":"n","type":"Calendar","props":{},"error":"unknown_component","fallback":"Mon\nTue"}"#)
        let sibling = try node(#"{"id":"s","type":"Summary","props":{}}"#)
        XCTAssertEqual(UiFallbackProblem.of(calendar, catalogVersion: 1), .unknown("Calendar"))
        XCTAssertEqual(UiFallbackProblem.of(flagged, catalogVersion: 1), .unknown("Calendar"))
        XCTAssertEqual(calendar.fallback, "Mon\nTue")
        XCTAssertNil(UiFallbackProblem.of(sibling, catalogVersion: 1))
        let unknown = try node(#"{"id":"x","type":"Gantt","props":{},"error":"unknown_component","fallback":"plan"}"#)
        let failed = try node(#"{"id":"y","type":"Stat","props":{},"error":"invalid_props","fallback":"Files"}"#)
        XCTAssertEqual(UiFallbackProblem.of(unknown, catalogVersion: 1), .unknown("Gantt"))
        XCTAssertEqual(UiFallbackProblem.of(failed, catalogVersion: 1), .failed)
        XCTAssertEqual(UiFallbackProblem.of(sibling, catalogVersion: 2), .unknown("Summary"))
    }

    func testAWholeBlockReadsAsTextOnlyForItsOwnReasons() throws {
        let newer: JSONValue = .object(["catalogVersion": .number(2), "nodes": .array([])])
        XCTAssertEqual(UiBlockText.of(block: newer, evaluated: [], diagnostics: [], error: nil), .unreadable)
        let broken: JSONValue = .object([
            "catalogVersion": .number(1), "nodes": .array([]),
            "diagnostics": .array([.object(["code": .string("over_budget"), "message": .string("Too many nodes")])]),
        ])
        XCTAssertEqual(UiBlockText.of(block: broken, evaluated: [], diagnostics: [], error: nil), .tooLarge)
        let block = try JSONValue.decode(Data(sliderBlock.utf8))
        XCTAssertNil(UiBlockText.of(block: block, evaluated: [], diagnostics: [], error: nil))
        XCTAssertEqual(
            UiBlockText.of(
                block: block, evaluated: [],
                diagnostics: [
                    .object(["code": .string("budget_exceeded"), "message": .string("Runtime node limit")])
                ], error: nil), .tooLarge)
        let diagnostic = broken.setting(
            "diagnostics",
            .array([
                .object(["code": .string("invalid_syntax"), "message": .string("Missing closing tag")])
            ]))
        XCTAssertEqual(
            UiBlockText.of(block: diagnostic, evaluated: [], diagnostics: [], error: nil),
            .diagnostic("Missing closing tag"))
        XCTAssertEqual(
            UiBlockText.of(block: block, evaluated: [], diagnostics: [], error: "Evaluation failed"), .unreadable)
    }

    func testTableColumnsComeFromColumnsOrFromTheRows() throws {
        let declared = try node(
            #"{"id":"t","type":"Table","props":{"rows":[{"name":"a","time":1200}]},"children":[{"id":"c1","type":"Column","props":{"key":"name"}},{"id":"c2","type":"Column","props":{"key":"time","as":"duration"}},{"id":"c3","type":"Column","props":{"key":"missing"}}]}"#
        )
        let columns = UiTableColumn.of(declared)
        XCTAssertEqual(columns.map(\.key), ["name", "time"])
        XCTAssertEqual(UiTableCell.of(.number(1200), column: columns[1]), .number(1200, .duration))
        XCTAssertEqual(UiTableCell.of(.string("soon"), column: columns[1]), .text("soon"))
        let derived = UiTableColumn.of(try node(#"{"id":"t","type":"Table","props":{"rows":[{"b":1,"a":"x"}]}}"#))
        XCTAssertEqual(derived.map(\.kind), [.text, .number])
    }

    func testChartsKeepSixSeriesAndSixtyRows() throws {
        let rows = (0..<70).map { #"{"label":"r\#($0)","a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7}"# }
        let chart = try XCTUnwrap(
            UiChartData(
                try node(#"{"id":"c","type":"Chart","props":{"kind":"bar","data":[\#(rows.joined(separator: ","))]}}"#))
        )
        XCTAssertEqual(chart.series.count, 6)
        XCTAssertEqual(chart.labels.count, 60)
        XCTAssertTrue(chart.truncated)
        XCTAssertEqual(chart.total, 70)
        XCTAssertEqual(chart.omitted, ["g"])
        XCTAssertEqual(chart.values.labels.count, 70)
        XCTAssertEqual(chart.values.series.count, 7)
        XCTAssertNil(UiChartData(try node(#"{"id":"c","type":"Chart","props":{"kind":"bar","data":[]}}"#)))
    }

    func testAChoiceOffersItselfOnlyWhenTheHostWouldSendIt() throws {
        func choice(_ children: String, complete: Bool = true, error: String? = nil) throws -> UiNode {
            let failed = error.map { #","error":"\#($0)""# } ?? ""
            return try node(
                #"{"id":"c","type":"Choice","props":{},"complete":\#(complete)\#(failed),"children":[\#(children)]}"#)
        }
        let text = { (value: String) in #"{"id":"t","type":"$text","props":{"text":"\#(value)"},"complete":true}"# }
        XCTAssertEqual(try choice(text(" Run   checks ")).choiceLabel, "Run checks")
        XCTAssertNil(
            try choice(
                text("Run ") + "," + #"{"id":"e","type":"$text","props":{},"complete":true,"error":"unknown_variable"}"#
            ).choiceLabel)
        XCTAssertNil(try choice(text("  ")).choiceLabel)
        XCTAssertNil(try choice("").choiceLabel)
        XCTAssertNil(try choice(text("Run"), complete: false).choiceLabel)
        XCTAssertNil(try choice(text("Run"), error: "invalid_syntax").choiceLabel)
    }

    func testAScaleNeedsASpanItCanDivideBy() throws {
        let stacked = try XCTUnwrap(
            UiChartData(
                try node(
                    #"{"id":"c","type":"Chart","props":{"kind":"stacked","data":[{"label":"Balance","income":10,"cost":-6}]}}"#
                )))
        XCTAssertEqual(stacked.kind, "bar")
        XCTAssertEqual(stacked.min, -6)
        let hbar = try XCTUnwrap(
            UiChartData(
                try node(
                    #"{"id":"c","type":"Chart","props":{"kind":"hbar","data":[{"label":"Core","value":-3}]}}"#)))
        XCTAssertEqual(hbar.kind, "hbar")
        XCTAssertEqual(UiChartData.range(hbar.min, hbar.max), -5...0)
        XCTAssertNil(
            UiChartData(
                try node(
                    #"{"id":"c","type":"Chart","props":{"kind":"bar","data":[{"label":"Huge","count":1.5e308}]}}"#)))
        XCTAssertNil(UiChartData.range(0, .leastNonzeroMagnitude))
        XCTAssertNil(UiChartData.range(0, 1e-310))
        XCTAssertNotNil(UiChartData.range(0, 1e-300))
        XCTAssertNil(
            UiChartData(
                try node(#"{"id":"c","type":"Chart","props":{"kind":"bar","data":[{"label":"Tiny","value":5e-324}]}}"#))
        )
    }

    func testDerivedTablesKeepEveryColumnAndFarDatesStayText() throws {
        let derived = UiTableColumn.of(
            try node(
                #"{"id":"t","type":"Table","props":{"rows":[{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9}]}}"#
            ))
        XCTAssertEqual(derived.map(\.key), ["a", "b", "c", "d", "e", "f", "g", "h", "i"])
        let date = UiTableColumn(key: "at", title: "at", unit: nil, kind: .date)
        XCTAssertEqual(UiTableCell.of(.number(0), column: date), .date(0))
        XCTAssertEqual(UiTableCell.of(.number(1e20), column: date), .text(UiTableCell.textOf(.number(1e20))))
    }

    func testLiveStatusNamesTheSourceThatFailed() {
        let block: JSONValue = .object([
            "queries": .object([
                "$a": .object(["source": .string("git.status")]), "$b": .object(["source": .string("launch.status")]),
            ])
        ])
        let readings: [String: JSONValue] = [
            "$a": .object(["state": .string("fresh"), "readAt": .number(2_000)]),
            "$b": .object(["state": .string("failed"), "readAt": .number(3_000), "reason": .string("gone")]),
        ]
        let live = UiLiveStatus.of(block: block, order: ["$b", "$a"], readings: readings, reading: false)
        XCTAssertEqual(live?.state, .failed)
        XCTAssertEqual(live?.source, "launch.status")
        XCTAssertEqual(live?.sources, ["launch.status", "git.status"])
        XCTAssertEqual(live?.readAt, Date(timeIntervalSince1970: 2))
        XCTAssertEqual(live?.reason, "gone")
    }

    func testAFailedReadKeepsTheTimeOfTheLastGoodOne() {
        let block: JSONValue = .object(["queries": .object(["$a": .object(["source": .string("git.status")])])])
        let readings: [String: JSONValue] = [
            "$a": .object(["state": .string("failed"), "readAt": .number(3_000), "code": .string("timed-out")])
        ]
        let live = UiLiveStatus.of(
            block: block, order: ["$a"], readings: readings, reading: false, lastReadAt: ["$a": 2_000])
        XCTAssertEqual(live?.state, .failed)
        XCTAssertEqual(live?.readAt, Date(timeIntervalSince1970: 2))
        XCTAssertEqual(live?.reason, String(localized: "The source took too long to answer."))
    }

    func testAKnownReasonCodeReadsInTheAppsWordsAndAnUnknownOneAsWritten() {
        XCTAssertEqual(
            UiReason.text(code: "timed-out", reason: "late"), String(localized: "The source took too long to answer."))
        XCTAssertEqual(UiReason.text(code: "from-a-newer-machine", reason: "As written"), "As written")
        XCTAssertNil(UiReason.text(code: nil, reason: nil))
    }

    private func reader(_ region: String = "nl_NL") -> FormatLocale {
        FormatLocale(
            region: Locale(identifier: region), language: Locale(identifier: "en"),
            timeZone: TimeZone(identifier: "Europe/Amsterdam")!)
    }

    func testAnEventTimeIsReadAsWrittenOrAsAnInstant() throws {
        let time = try XCTUnwrap(UiEventTime("14:05"))
        XCTAssertEqual(time.kind, .time)
        XCTAssertTrue(time.written)
        XCTAssertFalse(time.seconds)
        XCTAssertTrue(try XCTUnwrap(UiEventTime("15:41:55.123456789")).seconds)
        XCTAssertEqual(try XCTUnwrap(UiEventTime("2026-10-14")).kind, .date)
        XCTAssertEqual(try XCTUnwrap(UiEventTime("2026-10-14T14:05:30.250")).kind, .dateTime)
        XCTAssertFalse(try XCTUnwrap(UiEventTime("2026-10-14T14:05:30")).seconds)
        let offset = try XCTUnwrap(UiEventTime("2026-10-14T14:05:00+02:00"))
        XCTAssertFalse(offset.written)
        XCTAssertEqual(offset.date, ISO8601DateFormatter().date(from: "2026-10-14T12:05:00Z"))
        XCTAssertEqual(
            try XCTUnwrap(UiEventTime("2026-10-14T00:30:00-05:30")).date,
            ISO8601DateFormatter().date(from: "2026-10-14T06:00:00Z"))
        for good in ["-12:00", "+05:30", "+14:00"] {
            XCTAssertNotNil(UiEventTime("2026-10-14T12:00:00\(good)"), good)
        }
        for bad in ["-12:01", "-13:00", "+14:01", "+02:60", "+23:59"] {
            XCTAssertNil(UiEventTime("2026-10-14T12:00:00\(bad)"), bad)
        }
    }

    func testAnEventTimeThatNamesNoMomentIsNotRead() {
        for bad in [
            "", "2pm", "24:00", "14:60", "14:05:60", "14:05:3", "14:05:30.", "14:05:30Z", "9:05", "2026-02-30",
            "2026-13-01", "2026-10-14T25:00", "2026-10-14T14:05:61", "2026-10-14 14:05", "0050-01-01", "14:05Z",
            "14:05\n", "after lunch",
        ] {
            XCTAssertNil(UiEventTime(bad), bad)
        }
        XCTAssertNotNil(UiEventTime("2028-02-29"))
        XCTAssertNil(UiEventTime("2027-02-29"))
    }

    func testAnEventWritesItsTimeAsTheRegionDoesAndKeepsWhatItCannotRead() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-14T12:00:00Z"))
        func text(_ at: String, _ region: String = "nl_NL") -> String {
            UiEventTime.text(at, now: now, in: reader(region))
        }
        XCTAssertEqual(text("14:05"), "14:05")
        XCTAssertEqual(text("14:05", "en_US"), "02:05 PM")
        XCTAssertEqual(text("15:41:55"), "15:41:55")
        XCTAssertEqual(text("15:41:55.250"), "15:41:55")
        XCTAssertEqual(text("2026-03-02"), "2 Mar")
        XCTAssertEqual(text("2025-03-02"), "2 Mar 2025")
        XCTAssertEqual(text("2025-03-02T09:30"), "2 Mar 2025, 09:30")
        XCTAssertEqual(text("2027-06-01T12:00:00Z"), "1 Jun 2027, 14:00")
        // The clock change skips 02:30 in this zone; a time without an offset stays as written.
        XCTAssertEqual(text("2026-03-29T02:30"), "29 Mar, 02:30")
        XCTAssertEqual(text("after lunch"), "after lunch")
    }

    func testATextFieldIsCutAtItsLimitInTheUnitsTheInterpreterCounts() {
        XCTAssertEqual(UiTextLimit.clamp("Grace", to: 5), "Grace")
        XCTAssertEqual(UiTextLimit.clamp("Grace H", to: 5), "Grace")
        XCTAssertEqual(UiTextLimit.clamp("", to: 5), "")
        // An emoji is two units and a flag four; none is cut in half.
        XCTAssertEqual(UiTextLimit.clamp("ab😀c", to: 3), "ab")
        XCTAssertEqual(UiTextLimit.clamp("ab😀c", to: 4), "ab😀")
        XCTAssertEqual(UiTextLimit.clamp("🇳🇱🇳🇱", to: 6), "🇳🇱")
    }

    func testASelectNamesItselfByTheTextBesideItsOptions() throws {
        let select = try node(
            #"""
            {"id":"s","type":"Select","props":{"value":"a"},"children":[
            {"id":"s1","type":"Option","props":{"value":"a"},"children":[{"id":"t1","type":"$text","props":{"text":"Alpha"}}]},
            {"id":"t2","type":"$text","props":{"text":"  Pick a    mode "}}]}
            """#)
        XCTAssertEqual(select.ownLabel, "Pick a mode")
        XCTAssertEqual(select.label, "Alpha Pick a mode")
    }

    private func map(_ places: String, props: String = "{}", omitted: Int = 0) throws -> UiNode {
        try node(
            #"{"id":"m","type":"Map","props":\#(props),"complete":true,"omitted":\#(omitted),"children":[\#(places)]}"#)
    }

    private let utrecht =
        #"{"id":"p1","type":"Place","props":{"lat":52.0907,"lon":5.1214,"detail":"Cathedral tower","value":"dom"},"children":[{"id":"t1","type":"$text","props":{"text":"Domtoren"}}]}"#
    private let amsterdam =
        #"{"id":"p2","type":"Place","props":{"lat":52.3676,"lon":4.9041},"children":[{"id":"t2","type":"$text","props":{"text":"Amsterdam"}}]}"#
    private let unplaced =
        #"{"id":"p3","type":"Place","props":{"address":"Oudegracht 1, Utrecht"},"children":[{"id":"t3","type":"$text","props":{"text":"Canal house"}}]}"#

    func testAMapListsEveryPlaceAndMarksOnlyThoseWithAPoint() throws {
        let places = UiMapPlace.of(try map([utrecht, amsterdam, unplaced].joined(separator: ",")))
        XCTAssertEqual(places.map(\.number), [1, 2, 3])
        XCTAssertEqual(places.map(\.name), ["Domtoren", "Amsterdam", "Canal house"])
        XCTAssertEqual(places.map(\.hasPoint), [true, true, false])
        XCTAssertEqual(places[0].detail, "Cathedral tower")
        XCTAssertEqual(places[0].value, .string("dom"))
        XCTAssertEqual(places[2].address, "Oudegracht 1, Utrecht")
        XCTAssertNil(places[2].coordinate)
    }

    func testAPlaceWithoutANameIsListedByItsAddress() throws {
        let nameless = #"{"id":"p4","type":"Place","props":{"address":"Oudegracht 1"},"children":[]}"#
        let place = try XCTUnwrap(UiMapPlace.of(try map(nameless)).first)
        XCTAssertEqual(place.name, "Oudegracht 1")
        XCTAssertEqual(place.address, "")
    }

    func testAPlaceOutsideTheGlobeHasNoPoint() throws {
        let off =
            #"{"id":"p5","type":"Place","props":{"lat":95,"lon":5},"children":[{"id":"t5","type":"$text","props":{"text":"Nowhere"}}]}"#
        XCTAssertEqual(UiMapPlace.of(try map(off)).map(\.hasPoint), [false])
    }

    func testTheMapFitsItsMarkersWithRoomAndNeverZoomsToAStreet() throws {
        XCTAssertNil(UiMapFrame.fit(UiMapPlace.of(try map(unplaced))))
        let one = try XCTUnwrap(UiMapFrame.fit(UiMapPlace.of(try map(utrecht))))
        XCTAssertEqual(one.latitude, 52.0907, accuracy: 1e-9)
        XCTAssertEqual(one.latitudeSpan, 0.02, accuracy: 1e-9)
        let two = try XCTUnwrap(UiMapFrame.fit(UiMapPlace.of(try map([utrecht, amsterdam].joined(separator: ",")))))
        XCTAssertEqual(two.latitude, (52.0907 + 52.3676) / 2, accuracy: 1e-9)
        XCTAssertEqual(two.latitudeSpan, (52.3676 - 52.0907) * 1.5, accuracy: 1e-9)
        let corner = two.unit(lat: 52.3676, lon: 4.9041)
        XCTAssertTrue((0..<0.5).contains(corner.x) && (0..<0.5).contains(corner.y))
    }

    @MainActor func testAMapOutOfItsPlacesReadsHowManyWereLeftOut() async throws {
        try NativePresentationProbe.enableAccessibility()
        XCTAssertEqual(try map(utrecht, omitted: 3).omitted, 3)
        XCTAssertEqual(try node(#"{"id":"x","type":"Map","props":{}}"#).omitted, 0)
        func compiled(_ id: String, _ type: String, props: [String: JSONValue], children: [JSONValue] = []) -> JSONValue
        {
            .object([
                "id": .string(id), "type": .string(type), "props": .object(props), "expressions": .object([:]),
                "bindings": .object([:]), "children": .array(children), "complete": .bool(true),
                "start": .number(0), "end": .number(1), "fallback": .string(""),
            ])
        }
        let places = (0..<53).map { index in
            compiled(
                "p\(index)", "Place", props: ["address": .string("Address \(index)")],
                children: [
                    compiled("label\(index)", "$text", props: ["text": .string("Place \(index)")])
                ])
        }
        let block = try JSONValue.decode(Data(sliderBlock.utf8)).setting(
            "nodes",
            .array([
                compiled("map", "Map", props: [:], children: places)
            ]))
        let result = try await UiInterpreter().evaluate(block: block)
        let evaluated = try XCTUnwrap(UiNode(try XCTUnwrap(result["nodes"]?.arrayValue?.first)))
        XCTAssertEqual(evaluated.children(of: "Place").count, 50)
        XCTAssertEqual(evaluated.omitted, 3)
        let model = UiBlockModel(chatID: "map", itemID: "item", block: block) { _, _ in
            throw CancellationError()
        }
        let context = UiRenderContext(
            model: model, local: UiBlockLocal(), host: UiHost(), written: [], headID: nil, catalogVersion: 1)
        let host = UIHostingController(rootView: ScrollView { UiMapView(node: evaluated, context: context) })
        let window = UIWindow.showing(host, size: CGSize(width: 402, height: 874))
        defer {
            window.close()
            model.stop()
        }
        var caption: NSObject?
        for _ in 0..<120 {
            await displayFrames()
            if let scroll = NativePresentationProbe.elements(in: host.view).compactMap({ $0 as? UIScrollView }).first {
                scroll.setContentOffset(
                    CGPoint(x: 0, y: max(0, scroll.contentSize.height - scroll.bounds.height)), animated: false)
            }
            caption = NativePresentationProbe.elements(in: host.view).first {
                $0.accessibilityLabel == "3 more places not shown"
                    && window.convert(window.bounds, to: nil).intersects($0.accessibilityFrame)
            }
            if caption != nil { break }
        }
        XCTAssertNotNil(caption)
    }

    func testTheMapSaysWhyItHasNoBaseMap() throws {
        XCTAssertNil(UiMapView.note(tiles: true, online: true))
        let off = try XCTUnwrap(UiMapView.note(tiles: false, online: true))
        let offline = try XCTUnwrap(UiMapView.note(tiles: true, online: false))
        XCTAssertNotEqual(off, offline)
        XCTAssertEqual(UiMapView.note(tiles: false, online: false), off)
    }

    func testAModelReadsItsAttachmentAltAndCaption() throws {
        let model = try node(
            #"{"id":"m","type":"Model","props":{"attachment":"att-1","alt":"Bracket"},"complete":true,"children":[{"id":"t","type":"$text","props":{"text":"A printed bracket"}}]}"#
        )
        XCTAssertNil(UiFallbackProblem.of(model, catalogVersion: 1))
        XCTAssertEqual(model.string("attachment"), "att-1")
        XCTAssertEqual(model.string("alt"), "Bracket")
        XCTAssertEqual(model.label, "A printed bracket")
    }

    private func bytes(_ parts: [UInt8]...) -> Data { Data(parts.joined()) }

    private func littleEndian(_ value: UInt32) -> [UInt8] {
        (0..<4).map { UInt8(truncatingIfNeeded: value >> ($0 * 8)) }
    }

    private func zip(firstEntry name: String) -> Data {
        var header = [UInt8](repeating: 0, count: 30)
        header[0...3] = [0x50, 0x4b, 0x03, 0x04]
        header[26] = UInt8(name.utf8.count)
        return bytes(header, Array(name.utf8), [UInt8](repeating: 0, count: 16))
    }

    private func binaryStl(triangles: UInt32, header: String = "") -> Data {
        let title = Array(header.utf8) + [UInt8](repeating: 0, count: 80 - header.utf8.count)
        return bytes(title, littleEndian(triangles), [UInt8](repeating: 0, count: 50 * Int(triangles)))
    }

    private let triangle =
        "solid part\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 10 0 0\n   vertex 0 10 0\n  endloop\n endfacet\nendsolid part\n"

    func testAModelIsToldByItsBytesAndNotItsName() {
        XCTAssertEqual(UiModelFormat.of(bytes(Array("glTF".utf8), littleEndian(2), littleEndian(12))), .gltfBinary)
        XCTAssertNil(UiModelFormat.of(bytes(Array("glTF".utf8), littleEndian(1), littleEndian(12))))
        XCTAssertEqual(UiModelFormat.of(zip(firstEntry: "Model.USDC")), .usdz)
        XCTAssertEqual(UiModelFormat.of(zip(firstEntry: "scene.usda")), .usdz)
        XCTAssertNil(UiModelFormat.of(zip(firstEntry: "readme.txt")))
        XCTAssertEqual(UiModelFormat.of(binaryStl(triangles: 2)), .stl)
        XCTAssertEqual(UiModelFormat.of(binaryStl(triangles: 1, header: "solid exported by a binary writer")), .stl)
        XCTAssertNil(UiModelFormat.of(binaryStl(triangles: 2).dropLast()))
        XCTAssertEqual(UiModelFormat.of(Data(("  \n" + triangle).utf8)), .stl)
        XCTAssertEqual(UiModelFormat.of(Data("solid\nendsolid\n".utf8)), .stl)
        XCTAssertNil(UiModelFormat.of(Data("solidity is a word\n".utf8)))
        XCTAssertNil(UiModelFormat.of(Data("solid but nothing else".utf8)))
        XCTAssertNil(UiModelFormat.of(Data()))
    }

    func testOnlyGltfStaysARow() {
        XCTAssertFalse(UiModelFormat.gltfBinary.opens)
        XCTAssertTrue(UiModelFormat.usdz.opens)
        XCTAssertTrue(UiModelFormat.stl.opens)
    }

    func testAnStlOpensFramedAndTurnedYUp() throws {
        let model = try XCTUnwrap(UiModelScene.open(Data(triangle.utf8), format: .stl))
        let distance = simd_length(model.camera.simdPosition)
        XCTAssertGreaterThan(distance, 0)
        XCTAssertTrue(distance.isFinite)
        let turned = try XCTUnwrap(
            model.scene.rootNode.childNodes(passingTest: { node, _ in node.geometry != nil }).first)
        let up = turned.convertVector(SCNVector3(0, 0, 1), to: nil)
        XCTAssertEqual(up.y, 1, accuracy: 1e-5)
        XCTAssertNil(UiModelScene.open(Data(triangle.utf8), format: .gltfBinary))
    }

    func testTheTemporaryFileGoesWithTheScene() throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: "models", directoryHint: .isDirectory)
        let data = Data(triangle.replacingOccurrences(of: "part", with: UUID().uuidString).utf8)
        func files() throws -> Set<URL> {
            Set(
                try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
                    .filter { (try? Data(contentsOf: $0)) == data })
        }
        var first = try XCTUnwrap(UiModelScene.open(data, format: .stl)) as UiModelScene?
        let firstFile = try XCTUnwrap(files().first)
        XCTAssertEqual(try files(), [firstFile])
        var second = try XCTUnwrap(UiModelScene.open(data, format: .stl)) as UiModelScene?
        let secondFile = try XCTUnwrap(files().subtracting([firstFile]).first)
        XCTAssertEqual(try files(), [firstFile, secondFile])
        withExtendedLifetime((first, second)) {}
        first = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: firstFile.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: secondFile.path))
        second = nil
        XCTAssertTrue(try files().isEmpty)
    }

    func testEveryEvaluatedFixtureComponentIsInTheAppsCatalog() throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "intelligent-ui-presentation", withExtension: "json"))
        let cases = try XCTUnwrap(JSONValue.decode(Data(contentsOf: url)).arrayValue)
        XCTAssertFalse(cases.isEmpty)
        var visited = 0
        for fixture in cases {
            let name = fixture["name"]?.stringValue ?? ""
            func visit(_ list: [UiNode]) {
                for node in list where node.error == nil && !node.isText {
                    visited += 1
                    XCTAssertTrue(
                        UiCatalog.components.contains(node.type) || name == "unknown component", "\(name) \(node.type)")
                    visit(node.children)
                }
            }
            visit(UiNode.list(fixture["nodes"]?.arrayValue ?? []))
        }
        XCTAssertGreaterThan(visited, 0)
    }

    /// Labels, table columns and chart data against the desktop's own functions, from fixtures the generator writes.
    func testTablesChartsAndLabelsMatchTheDesktop() throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "intelligent-ui-presentation", withExtension: "json"))
        let cases = try XCTUnwrap(JSONValue.decode(Data(contentsOf: url)).arrayValue)
        XCTAssertFalse(cases.isEmpty)
        for fixture in cases {
            let name = fixture["name"]?.stringValue ?? ""
            var nodes: [String: UiNode] = [:]
            func visit(_ list: [UiNode]) {
                for node in list {
                    nodes[node.id] = node
                    visit(node.children)
                }
            }
            visit(UiNode.list(fixture["nodes"]?.arrayValue ?? []))
            for (id, expected) in fixture["expected"]?.objectValue ?? [:] {
                let node = try XCTUnwrap(nodes[id], name)
                XCTAssertEqual(node.label, expected["label"]?.stringValue, "\(name) \(id)")
                if let columns = expected["columns"]?.arrayValue {
                    let actual = UiTableColumn.of(node)
                    let wanted = columns.map {
                        UiTableColumn(
                            key: $0["key"]?.stringValue ?? "", title: $0["title"]?.stringValue ?? "",
                            unit: $0["unit"]?.stringValue,
                            kind: UiTableColumn.Kind(rawValue: $0["as"]?.stringValue ?? "") ?? .text)
                    }
                    if node.children(of: "Column").isEmpty {
                        // Derived columns follow the rows' key order on the desktop; that order does not reach the app.
                        XCTAssertEqual(actual.sorted { $0.key < $1.key }, wanted.sorted { $0.key < $1.key }, name)
                    } else {
                        XCTAssertEqual(actual, wanted, name)
                    }
                }
                if let choiceLabel = expected["choiceLabel"] {
                    XCTAssertEqual(node.choiceLabel, choiceLabel.stringValue, "\(name) \(id)")
                }
                if let chart = expected["chart"] {
                    let actual = UiChartData(node)
                    guard let actual, chart != .null else {
                        XCTAssertEqual(actual == nil, chart == .null, name)
                        continue
                    }
                    XCTAssertEqual(actual.labels, chart["labels"]?.arrayValue?.compactMap(\.stringValue), name)
                    XCTAssertEqual(actual.min, chart["min"]?.numberValue, name)
                    XCTAssertEqual(actual.max, chart["max"]?.numberValue, name)
                    XCTAssertEqual(actual.truncated, chart["truncated"]?.boolValue, name)
                    XCTAssertEqual(actual.kind, chart["kind"]?.stringValue, name)
                    XCTAssertEqual(actual.total, chart["total"]?.numberValue.map { Int($0) }, name)
                    XCTAssertEqual(
                        Set(actual.omitted), Set(chart["omitted"]?.arrayValue?.compactMap(\.stringValue) ?? []), name)
                    var series: [String: [Double?]] = [:]
                    for entry in chart["series"]?.arrayValue ?? [] {
                        series[entry["key"]?.stringValue ?? ""] = (entry["values"]?.arrayValue ?? []).map(\.numberValue)
                    }
                    XCTAssertEqual(
                        Dictionary(uniqueKeysWithValues: actual.series.map { ($0.key, $0.values) }), series, name)
                }
            }
        }
    }

    @MainActor private func saveModel(
        list: @escaping @MainActor (String) throws -> JSONValue
    ) throws -> ImageSaveModel {
        let root: JSONValue = .object([
            "folder": .string("/work/ruimte"), "projectName": .string("ruimte"), "name": .string("rabbit.png"),
        ])
        return try ImageSaveModel(
            chatID: "c", attachmentID: "a", root: root,
            request: { _, payload in try list(payload["path"]?.stringValue ?? "") }, done: { _ in })
    }

    private func entries(_ names: [String], truncated: Bool = false) -> JSONValue {
        .object([
            "entries": .array(names.map { .object(["kind": .string("directory"), "name": .string($0)]) }),
            "truncated": .bool(truncated),
        ])
    }

    @MainActor func testTheFolderPickerStartsAtTheProjectRootAndNestsWhatIsOpen() async throws {
        struct Unreadable: Error, LocalizedError { var errorDescription: String? { "denied" } }
        let model = try saveModel { path in
            switch path {
            case "/work/ruimte": return self.entries(["docs", "assets"], truncated: true)
            case "/work/ruimte/assets": return self.entries([])
            default: throw Unreadable()
            }
        }
        XCTAssertEqual(
            ImageSaveFolderTree.rows(of: model, expanded: [""]).map(\.kind),
            [.folder(directory: "", name: "ruimte", expandable: true)])
        await model.loadFolders()
        await model.loadFolders("assets")
        await model.loadFolders("docs")
        let rows = ImageSaveFolderTree.rows(of: model, expanded: ["", "assets", "docs"])
        XCTAssertEqual(
            rows.map(\.kind),
            [
                .folder(directory: "", name: "ruimte", expandable: true),
                .folder(directory: "assets", name: "assets", expandable: false),
                .folder(directory: "docs", name: "docs", expandable: true),
                .failed(directory: "docs", message: "denied"),
                .truncated,
            ])
        XCTAssertEqual(rows.map(\.depth), [0, 1, 1, 2, 1])
        XCTAssertEqual(ImageSaveFolderTree.rows(of: model, expanded: []).count, 1)
    }

    @MainActor func testTheSaveHintNamesThePathUnderTheProject() throws {
        let model = try saveModel { _ in self.entries([]) }
        XCTAssertEqual(ImageSaveFolderTree.hint(model), "ruimte/rabbit.png")
        model.selectDirectory("assets/art")
        XCTAssertEqual(ImageSaveFolderTree.hint(model), "ruimte/assets/art/rabbit.png")
    }
}
