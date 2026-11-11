import Foundation
import Synchronization

public enum Presence<Value: Codable & Sendable & Equatable>: Sendable, Equatable {
    case missing
    case null
    case value(Value)

    /// The value when one was sent; `null` and a missing field read the same.
    public var present: Value? { if case .value(let value) = self { value } else { nil } }
}

public enum WireValidationError: Error, LocalizedError, Sendable, Equatable {
    case invalid(String)

    public var errorDescription: String? {
        switch self {
        case .invalid(let reason): reason
        }
    }
}

public enum JSONValue: Codable, Sendable, Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public subscript(_ key: String) -> JSONValue? { objectValue?[key] }
    public var objectValue: [String: JSONValue]? { if case .object(let value) = self { value } else { nil } }
    public var arrayValue: [JSONValue]? { if case .array(let value) = self { value } else { nil } }
    public var stringValue: String? { if case .string(let value) = self { value } else { nil } }
    public var numberValue: Double? { if case .number(let value) = self { value } else { nil } }
    public var boolValue: Bool? { if case .bool(let value) = self { value } else { nil } }

    public static func decode(_ data: Data) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: replacingLoneSurrogates(in: data))
    }

    /// `JSON.stringify` writes half of a surrogate pair as an escape of its own, which `JSONDecoder` refuses along with
    /// the whole document. Each such half becomes U+FFFD, so one cut emoji costs a character instead of the frame.
    public static func replacingLoneSurrogates(in data: Data) -> Data {
        let backslash = UInt8(ascii: "\\")
        return data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> Data in
            // The UTF-16 unit of the `\uXXXX` escape at `index`, if there is one.
            func unit(at index: Int) -> UInt16? {
                guard index + 6 <= bytes.count, bytes[index] == backslash, bytes[index + 1] == UInt8(ascii: "u") else {
                    return nil
                }
                var value: UInt16 = 0
                for byte in bytes[(index + 2)..<(index + 6)] {
                    guard let digit = hexDigit(byte) else { return nil }
                    value = value << 4 | UInt16(digit)
                }
                return value
            }
            var output: Data?
            var copied = 0
            var index = 0
            while index < bytes.count {
                guard bytes[index] == backslash else {
                    index += 1
                    continue
                }
                guard let value = unit(at: index) else {
                    // Any other escape, `\\` included, is two bytes.
                    index += 2
                    continue
                }
                if (0xD800...0xDBFF).contains(value), let next = unit(at: index + 6), (0xDC00...0xDFFF).contains(next) {
                    index += 12
                    continue
                }
                if (0xD800...0xDFFF).contains(value) {
                    output = output ?? Data(capacity: bytes.count)
                    output?.append(contentsOf: bytes[copied..<index])
                    output?.append(contentsOf: Array(#"�"#.utf8))
                    copied = index + 6
                }
                index += 6
            }
            guard var output else { return data }
            output.append(contentsOf: bytes[copied...])
            return output
        }
    }

    private static func hexDigit(_ byte: UInt8) -> UInt8? {
        switch byte {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): byte - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): byte - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): byte - UInt8(ascii: "A") + 10
        default: nil
        }
    }
    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}

extension KeyedDecodingContainer {
    /// A list stamped `x-lossy-items`, without the elements this app cannot read.
    func decodeLossy<Element: Decodable>(_ type: [Element].Type, forKey key: Key) throws -> [Element] {
        try decode([WireSchema.Lossy<Element>].self, forKey: key).compactMap(\.value)
    }
}

public enum WireSchema {
    private static let schemas: Result<JSONValue, Error> = Result {
        guard let url = Bundle.module.url(forResource: "schemas", withExtension: "json") else {
            throw WireValidationError.invalid("Missing generated schemas")
        }
        return try JSONValue.decode(Data(contentsOf: url))
    }

    /// The generated schema of `name`, for a choice the app offers from what the wire takes, such as the languages of
    /// `voice.start`, so the two never drift apart.
    public static func schema(_ name: String) -> JSONValue? {
        try? schemas.get()[name]
    }

    /// Every generated schema by name, for tests that hold what the app implements to what the schemas stamp.
    static var all: [String: JSONValue] { (try? schemas.get())?.objectValue ?? [:] }

    @discardableResult
    public static func validate(_ name: String, _ value: JSONValue) throws -> JSONValue {
        guard let schema = try schemas.get()[name] else { throw WireValidationError.invalid("Unknown schema: \(name)") }
        return try parse(value, schema: schema, path: name, definitions: schema["$defs"])
    }

    /// Compiled once per pattern, since every frame is validated.
    private static let expressions = Mutex<[String: NSRegularExpression]>([:])

    private static func expression(_ pattern: String) throws -> NSRegularExpression {
        if let cached = expressions.withLock({ $0[pattern] }) { return cached }
        let compiled = try NSRegularExpression(pattern: pattern)
        expressions.withLock { $0[pattern] = compiled }
        return compiled
    }

    private static func parse(_ input: JSONValue, schema: JSONValue, path: String, definitions: JSONValue?) throws
        -> JSONValue
    {
        // A recursive schema, like the steps of a plan, points back at a definition beside its root.
        if let reference = schema["$ref"]?.stringValue {
            guard reference.hasPrefix("#/$defs/"),
                let target = definitions?[String(reference.dropFirst("#/$defs/".count))]
            else {
                throw WireValidationError.invalid("Unsupported generated schema at \(path)")
            }
            return try parse(input, schema: target, path: path, definitions: definitions)
        }
        let value = try projectEntry(input, metadata: schema["x-project-entry"])
        let fail = { WireValidationError.invalid("Invalid \(path)") }
        if let open = schema["x-open-union"], let options = (schema["oneOf"] ?? schema["anyOf"])?.arrayValue {
            return try parseOpenUnion(value, options: options, open: open, path: path, definitions: definitions)
        }
        if let options = (schema["oneOf"] ?? schema["anyOf"])?.arrayValue {
            for option in options where !literalMismatch(value, schema: option) {
                if let parsed = try? parse(value, schema: option, path: path, definitions: definitions) {
                    return parsed
                }
            }
            throw fail()
        }
        if let literal = schema["const"], literal != value { throw fail() }
        if let choices = schema["enum"]?.arrayValue, !choices.contains(value) { throw fail() }
        if let types = schema["type"]?.arrayValue {
            for type in types {
                var candidate = schema.objectValue ?? [:]
                candidate["type"] = type
                if let parsed = try? parse(value, schema: .object(candidate), path: path, definitions: definitions) {
                    return parsed
                }
            }
            throw fail()
        }
        switch schema["type"]?.stringValue {
        case "null":
            guard value == .null else { throw fail() }
        case "boolean":
            guard value.boolValue != nil else { throw fail() }
        case "integer", "number":
            guard let number = value.numberValue, number.isFinite else { throw fail() }
            if schema["type"]?.stringValue == "integer", number.rounded() != number { throw fail() }
            if let minimum = schema["minimum"]?.numberValue, number < minimum { throw fail() }
            if let maximum = schema["maximum"]?.numberValue, number > maximum { throw fail() }
            if let minimum = schema["exclusiveMinimum"]?.numberValue, number <= minimum { throw fail() }
            if let maximum = schema["exclusiveMaximum"]?.numberValue, number >= maximum { throw fail() }
        case "string":
            guard let string = value.stringValue else { throw fail() }
            if schema["minLength"] != nil || schema["maxLength"] != nil {
                // Zod and JSON Schema bounds count Unicode code points.
                let length = Double(string.unicodeScalars.count)
                if let minimum = schema["minLength"]?.numberValue, length < minimum { throw fail() }
                if let maximum = schema["maxLength"]?.numberValue, length > maximum { throw fail() }
            }
            if let pattern = schema["pattern"]?.stringValue {
                guard
                    try expression(pattern).firstMatch(in: string, range: NSRange(string.startIndex..., in: string))
                        != nil
                else {
                    throw fail()
                }
            }
        case "array":
            guard let array = value.arrayValue else { throw fail() }
            if let minimum = schema["minItems"]?.numberValue, Double(array.count) < minimum { throw fail() }
            if let maximum = schema["maxItems"]?.numberValue, Double(array.count) > maximum { throw fail() }
            let prefix = schema["prefixItems"]?.arrayValue ?? []
            if schema["x-lossy-items"] == .bool(true), let item = schema["items"] {
                return .array(
                    array.enumerated().compactMap { index, value in
                        try? parse(value, schema: item, path: "\(path)[\(index)]", definitions: definitions)
                    })
            }
            return .array(
                try array.enumerated().map { index, value in
                    if index < prefix.count {
                        return try parse(
                            value, schema: prefix[index], path: "\(path)[\(index)]", definitions: definitions)
                    }
                    if schema["items"] == .bool(false) { throw fail() }
                    guard let item = schema["items"], item.objectValue != nil else { return value }
                    return try parse(value, schema: item, path: "\(path)[\(index)]", definitions: definitions)
                })
        case "object":
            guard let object = value.objectValue else { throw fail() }
            let required = schema["required"]?.arrayValue ?? []
            let properties = schema["properties"]?.objectValue ?? [:]
            var result: [String: JSONValue] = [:]
            if let additional = schema["additionalProperties"] {
                for (key, input) in object where properties[key] == nil {
                    if additional == .bool(false) { throw fail() }
                    if additional == .bool(true) {
                        result[key] = input
                        continue
                    }
                    if let propertyNames = schema["propertyNames"] {
                        _ = try parse(
                            .string(key), schema: propertyNames, path: "\(path).key", definitions: definitions)
                    }
                    result[key] = try parse(input, schema: additional, path: "\(path).\(key)", definitions: definitions)
                }
            }
            for (key, property) in properties {
                if let input = object[key] {
                    result[key] = try parse(input, schema: property, path: "\(path).\(key)", definitions: definitions)
                } else if let fallback = property["default"] {
                    result[key] = fallback
                } else if required.contains(.string(key)) {
                    throw WireValidationError.invalid("Missing \(path).\(key)")
                }
            }
            for refinement in schema["x-refinements"]?.arrayValue ?? [] {
                guard refinementHolds(refinement, result) else { throw fail() }
            }
            return schema["x-output-null"] == .bool(true) ? .null : .object(result)
        case nil: break
        default: throw WireValidationError.invalid("Unsupported generated schema at \(path)")
        }
        return value
    }

    /// The key on a member of an open union this app cannot read, which the generated decoders read as `unknown`.
    public static let unknownMark = "x-unknown"

    /// A newer machine may add a member to an open union, or a value inside a member. Such a member keeps its place,
    /// marked, once its tag and the fields every member shares hold, so one item never refuses a whole thread.
    private static func parseOpenUnion(
        _ value: JSONValue, options: [JSONValue], open: JSONValue, path: String, definitions: JSONValue?
    ) throws -> JSONValue {
        guard let tag = open["tag"]?.stringValue, var object = value.objectValue, let word = object[tag],
            word.stringValue != nil
        else {
            throw WireValidationError.invalid("Invalid \(path)")
        }
        let members = options.map { resolved($0, definitions: definitions) }
        if let member = members.first(where: { $0["properties"]?[tag]?["const"] == word }),
            let parsed = try? parse(value, schema: member, path: path, definitions: definitions)
        {
            return parsed
        }
        for key in open["base"]?.arrayValue?.compactMap(\.stringValue) ?? [] {
            guard let input = object[key], let property = members.first?["properties"]?[key] else {
                throw WireValidationError.invalid("Missing \(path).\(key)")
            }
            _ = try parse(input, schema: property, path: "\(path).\(key)", definitions: definitions)
        }
        object[unknownMark] = .bool(true)
        return .object(object)
    }

    /// One element of a list stamped `x-lossy-items`, which reads as nil where the interpreter left it out.
    struct Lossy<Element: Decodable>: Decodable {
        let value: Element?

        init(from decoder: Decoder) throws {
            value = try? Element(from: decoder)
        }
    }

    private static func resolved(_ schema: JSONValue, definitions: JSONValue?) -> JSONValue {
        guard let reference = schema["$ref"]?.stringValue, reference.hasPrefix("#/$defs/"),
            let target = definitions?[String(reference.dropFirst("#/$defs/".count))]
        else { return schema }
        return target
    }

    /// The refinements the phone runs, by the name `packages/contracts/scripts/refinements.ts` stamps as
    /// `x-refinements`. A stamped name missing here fails `WireSchemaTests`, so the table cannot fall behind.
    public static let enforcedRefinements: [String: @Sendable ([String: JSONValue], JSONValue) -> Bool] = [
        "message-content": { result, _ in
            !(result["text"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
                || !(result["attachments"]?.arrayValue?.isEmpty ?? true)
        },
        "follow-dimensions": { result, _ in
            let hasColumns = result["cols"] != nil
            let hasRows = result["rows"] != nil
            return hasColumns == hasRows && (hasColumns || result["follow"] == .bool(true))
        },
        "statement-lifetime": { result, parameters in
            guard let lifetime = parameters["lifetimeMs"]?.numberValue, let issuedAt = result["issuedAt"]?.numberValue,
                let expiresAt = result["expiresAt"]?.numberValue
            else { return false }
            return expiresAt > issuedAt && expiresAt - issuedAt <= lifetime
        },
        "voice-stop-target": { result, _ in (result["sessionId"] == nil) != (result["startId"] == nil) },
        "project-id-or-folder": { result, _ in
            !(result["projectId"]?.stringValue?.isEmpty ?? true) || !(result["folder"]?.stringValue?.isEmpty ?? true)
        },
    ]

    private static func refinementHolds(_ refinement: JSONValue, _ result: [String: JSONValue]) -> Bool {
        guard let name = refinement["name"]?.stringValue, let check = enforcedRefinements[name] else { return false }
        return check(result, refinement)
    }

    private static let literalKeys = ["kind", "type", "ok", "action"]

    private static func literalMismatch(_ input: JSONValue, schema: JSONValue) -> Bool {
        guard let object = input.objectValue, let properties = schema["properties"]?.objectValue else { return false }
        for key in literalKeys {
            if let property = properties[key], literalMismatch(object[key], property: property) {
                return canSkipLiteral(schema)
            }
        }
        for (key, property) in properties {
            if literalMismatch(object[key], property: property) { return canSkipLiteral(schema) }
        }
        return false
    }

    private static func canSkipLiteral(_ schema: JSONValue) -> Bool {
        // A wrapper can transform or short-circuit before checking a local literal.
        schema["type"] == .string("object") && schema["$ref"] == nil && schema["oneOf"] == nil
            && schema["anyOf"] == nil && schema["x-project-entry"] == nil
    }

    private static func literalMismatch(_ input: JSONValue?, property: JSONValue) -> Bool {
        guard let literal = property["const"], let input, input != literal else { return false }
        return property["$ref"] == nil && property["oneOf"] == nil && property["anyOf"] == nil
            && property["x-project-entry"] == nil
    }

    private static func projectEntry(_ input: JSONValue, metadata: JSONValue?) throws -> JSONValue {
        guard let metadata, var entry = input.objectValue else { return input }
        let isNode = metadata["node"] == .bool(true)
        if entry["kind"] == .string("unknown"), var raw = entry["raw"]?.objectValue {
            if isNode {
                let original = unknownEntry(raw, metadata: metadata)
                for key in ["id", "x", "y", "w", "h"] where entry[key] != original[key] {
                    raw[key] = entry[key]
                }
            }
            entry = raw
        }
        guard let kind = entry["kind"]?.stringValue, !kind.isEmpty, kind != "unknown",
            !(metadata["knownKinds"]?.arrayValue?.contains(.string(kind)) ?? false),
            let id = entry["id"]?.stringValue, !id.isEmpty
        else { return .object(entry) }
        return .object(unknownEntry(entry, metadata: metadata))
    }

    private static func unknownEntry(_ raw: [String: JSONValue], metadata: JSONValue) -> [String: JSONValue] {
        var result = metadata["template"]?.objectValue ?? [:]
        result["id"] = raw["id"]
        result["raw"] = .object(raw)
        if metadata["node"] == .bool(true) {
            result["title"] = raw["title"]?.stringValue.map(JSONValue.string) ?? raw["kind"]
            for key in ["x", "y", "w", "h"] {
                if let value = raw[key]?.numberValue, value.isFinite, !["w", "h"].contains(key) || value > 0 {
                    result[key] = .number(value)
                }
            }
        } else {
            result["name"] = raw["name"]?.stringValue.flatMap { $0.isEmpty ? nil : .string($0) } ?? raw["kind"]
            if let creator = raw["createdBy"]?.stringValue, !creator.isEmpty { result["createdBy"] = .string(creator) }
        }
        return result
    }
}
