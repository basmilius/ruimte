import Foundation
import RuimtePulsar

/// Times the steps every `chat.attach` reply and `chat.event` takes on the phone: the JSON parse, the schema
/// interpreter and the typed decode. Run with `swift run -c release wire-benchmark [path to wire.json]`.
@main
enum WireBenchmark {
    static func main() throws {
        let fixturePath =
            CommandLine.arguments.dropFirst().first ?? "../RuimtePulsar/Tests/RuimtePulsarTests/Fixtures/wire.json"
        let fixture = try JSONValue.decode(Data(contentsOf: URL(fileURLWithPath: fixturePath)))
        let validations = fixture["validations"]?.arrayValue ?? []
        guard
            let attach = validations.first(where: { $0["schema"] == .string("request.chat.attach.result") })?[
                "output"],
            let event = validations.first(where: { $0["schema"] == .string("event.chat.event") })?["output"]
        else { throw BenchmarkFailure.missingFixture }

        let coldStart = ContinuousClock.now
        _ = try WireSchema.validate("request.chat.attach.result", attach)
        print("cold first validate (loads schemas.json): \(format(ContinuousClock.now - coldStart)) ms\n")

        print("dataset\tbytes\tstep\tmedian_ms\tmin_ms\tmax_ms")
        let large = try reply(page(from: attach, targetBytes: 512 * 1024))
        try time("page", large, schema: "request.chat.attach.result") { try $0.decoded(as: ChatAttachResult.self) }
        let small = try reply(page(from: attach, targetBytes: 0))
        try time("page-small", small, schema: "request.chat.attach.result") {
            try $0.decoded(as: ChatAttachResult.self)
        }
        let frame = try JSONValue.object(["type": .string("event"), "event": .string("chat.event"), "payload": event])
            .encoded()
        try time("event", frame, schema: "event.chat.event") { try $0.decoded(as: ChatEventEnvelope.self) }
    }

    /// Sixty items of every kind the fixture holds, the size of one history page, with the text of assistant and
    /// tool items grown until the page reaches `targetBytes`.
    private static func page(from attach: JSONValue, targetBytes: Int) throws -> JSONValue {
        guard var result = attach.objectValue, let kinds = attach["items"]?.arrayValue, !kinds.isEmpty else {
            throw BenchmarkFailure.missingFixture
        }
        var items = (0..<60).map { index -> [String: JSONValue] in
            var item = kinds[index % kinds.count].objectValue ?? [:]
            item["id"] = .string("item-\(index)")
            return item
        }
        result["items"] = .array(items.map(JSONValue.object))
        result.removeValue(forKey: "events")
        var repeats = 1
        while try JSONValue.object(result).encoded().count < targetBytes {
            repeats *= 2
            for index in items.indices where items[index]["kind"] == .string("assistant") {
                items[index]["text"] = .string(String(repeating: "Some output of a turn. ", count: repeats))
            }
            for index in items.indices where items[index]["kind"] == .string("tool") {
                items[index]["output"] = .string(String(repeating: "line of tool output\n", count: repeats))
            }
            result["items"] = .array(items.map(JSONValue.object))
        }
        return .object(result)
    }

    private static func reply(_ result: JSONValue) throws -> Data {
        try JSONValue.object(["id": .string("r1"), "ok": .bool(true), "result": result]).encoded()
    }

    private static func time(
        _ name: String, _ data: Data, schema: String, decode: (JSONValue) throws -> some Any
    ) throws {
        let parse = try samples { _ = try JSONValue.decode(data) }
        let frame = try JSONValue.decode(data)
        let body = frame["result"] ?? frame["payload"] ?? .null
        // A reply passes `ReplySchema` before its result, as `MachineClient.receive` does; an event has no envelope.
        let validate = try samples {
            if frame["result"] != nil { _ = try WireSchema.validate("ReplySchema", frame) }
            _ = try WireSchema.validate(schema, body)
        }
        let validated = try WireSchema.validate(schema, body)
        let typed = try samples { _ = try decode(validated) }
        for (step, values) in [("parse", parse), ("validate", validate), ("decode", typed)] {
            let row = [values[values.count / 2], values[0], values[values.count - 1]].map(format)
            print("\(name)\t\(data.count)\t\(step)\t\(row.joined(separator: "\t"))")
        }
    }

    private static func samples(_ work: () throws -> Void) throws -> [Duration] {
        for _ in 0..<3 { try work() }
        var values: [Duration] = []
        for _ in 0..<21 { values.append(try ContinuousClock().measure(work)) }
        return values.sorted()
    }

    private static func format(_ duration: Duration) -> String {
        let parts = duration.components
        return String(format: "%.3f", Double(parts.seconds) * 1000 + Double(parts.attoseconds) / 1e15)
    }

    private enum BenchmarkFailure: Error {
        case missingFixture
    }
}
