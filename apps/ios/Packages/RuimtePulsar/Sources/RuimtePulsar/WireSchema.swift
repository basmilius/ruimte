import Foundation

public enum Presence<Value: Codable & Sendable & Equatable>: Sendable, Equatable {
    case missing
    case null
    case value(Value)
}

public enum WireValidationError: Error, Sendable, Equatable {
    case invalid(String)
}

public struct WireCodingKey: CodingKey {
    public var stringValue: String
    public var intValue: Int? { nil }
    public init(stringValue: String) { self.stringValue = stringValue }
    public init?(intValue: Int) { return nil }
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
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
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
    public var objectValue: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
    public var arrayValue: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    public var stringValue: String? { if case .string(let value) = self { return value }; return nil }
    public var numberValue: Double? { if case .number(let value) = self { return value }; return nil }
    public var boolValue: Bool? { if case .bool(let value) = self { return value }; return nil }
    public static func decode(_ data: Data) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: data) }
    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}

public enum WireSchema {
    private static let schemas: Result<JSONValue, Error> = Result {
        guard let url = Bundle.module.url(forResource: "schemas", withExtension: "json") else {
            throw WireValidationError.invalid("Missing generated schemas")
        }
        return try JSONValue.decode(Data(contentsOf: url))
    }

    @discardableResult
    public static func validate(_ name: String, _ value: JSONValue) throws -> JSONValue {
        guard let schema = try schemas.get()[name] else { throw WireValidationError.invalid("Unknown schema: \(name)") }
        return try parse(value, schema: schema, path: name)
    }

    private static func parse(_ value: JSONValue, schema: JSONValue, path: String) throws -> JSONValue {
        let fail = { WireValidationError.invalid("Invalid \(path)") }
        if let options = (schema["oneOf"] ?? schema["anyOf"])?.arrayValue {
            for option in options {
                if let parsed = try? parse(value, schema: option, path: path) { return parsed }
            }
            throw fail()
        }
        if let literal = schema["const"], literal != value { throw fail() }
        if let choices = schema["enum"]?.arrayValue, !choices.contains(value) { throw fail() }
        if let types = schema["type"]?.arrayValue {
            for type in types {
                var candidate = schema.objectValue ?? [:]
                candidate["type"] = type
                if let parsed = try? parse(value, schema: .object(candidate), path: path) { return parsed }
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
            // Zod's limits count UTF-16 units, including both halves of an emoji.
            let length = Double(string.utf16.count)
            if let minimum = schema["minLength"]?.numberValue, length < minimum { throw fail() }
            if let maximum = schema["maxLength"]?.numberValue, length > maximum { throw fail() }
            if let pattern = schema["pattern"]?.stringValue {
                let expression = try NSRegularExpression(pattern: pattern)
                guard expression.firstMatch(in: string, range: NSRange(string.startIndex..., in: string)) != nil else { throw fail() }
            }
        case "array":
            guard let array = value.arrayValue else { throw fail() }
            if let minimum = schema["minItems"]?.numberValue, Double(array.count) < minimum { throw fail() }
            if let maximum = schema["maxItems"]?.numberValue, Double(array.count) > maximum { throw fail() }
            guard let item = schema["items"] else { throw fail() }
            return .array(try array.enumerated().map { try parse($0.element, schema: item, path: "\(path)[\($0.offset)]") })
        case "object":
            guard let object = value.objectValue else { throw fail() }
            let required = schema["required"]?.arrayValue?.compactMap(\.stringValue) ?? []
            let properties = schema["properties"]?.objectValue ?? [:]
            var result: [String: JSONValue] = [:]
            if properties.isEmpty, let additional = schema["additionalProperties"], additional.objectValue != nil {
                for (key, input) in object {
                    if let propertyNames = schema["propertyNames"] {
                        _ = try parse(.string(key), schema: propertyNames, path: "\(path).key")
                    }
                    result[key] = try parse(input, schema: additional, path: "\(path).\(key)")
                }
            }
            for (key, property) in properties {
                if let input = object[key] {
                    result[key] = try parse(input, schema: property, path: "\(path).\(key)")
                } else if let fallback = property["default"] {
                    result[key] = fallback
                } else if required.contains(key) {
                    throw WireValidationError.invalid("Missing \(path).\(key)")
                }
            }
            if let lifetime = schema["x-statement-lifetime-ms"]?.numberValue {
                guard let issuedAt = result["issuedAt"]?.numberValue, let expiresAt = result["expiresAt"]?.numberValue,
                      expiresAt > issuedAt, expiresAt - issuedAt <= lifetime else { throw fail() }
            }
            return .object(result)
        case nil: break
        default: throw WireValidationError.invalid("Unsupported generated schema at \(path)")
        }
        return value
    }
}
