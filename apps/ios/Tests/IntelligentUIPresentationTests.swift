import RuimteIntelligentUI
import RuimtePulsar
import XCTest

@testable import Ruimte

final class IntelligentUIPresentationTests: XCTestCase {
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

    func testAPartThisVersionCannotDrawFallsBackAlone() throws {
        let unknown = try node(#"{"id":"x","type":"Gantt","props":{},"error":"unknown_component","fallback":"plan"}"#)
        let failed = try node(#"{"id":"y","type":"Stat","props":{},"error":"invalid_props","fallback":"Files"}"#)
        let fine = try node(#"{"id":"z","type":"Summary","props":{}}"#)
        XCTAssertEqual(UiFallbackProblem.of(unknown, catalogVersion: 1), .unknown("Gantt"))
        XCTAssertEqual(UiFallbackProblem.of(failed, catalogVersion: 1), .failed)
        XCTAssertNil(UiFallbackProblem.of(fine, catalogVersion: 1))
        XCTAssertEqual(UiFallbackProblem.of(fine, catalogVersion: 2), .unknown("Summary"))
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
        XCTAssertNil(UiChartData(try node(#"{"id":"c","type":"Chart","props":{"kind":"bar","data":[]}}"#)))
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
        let live = UiLiveStatus.of(block: block, readings: readings, reading: false)
        XCTAssertEqual(live?.state, .failed)
        XCTAssertEqual(live?.source, "launch.status")
        XCTAssertEqual(live?.readAt, Date(timeIntervalSince1970: 2))
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
