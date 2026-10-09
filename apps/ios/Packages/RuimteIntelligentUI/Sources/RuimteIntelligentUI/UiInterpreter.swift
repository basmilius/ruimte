import Foundation
import JavaScriptCore
import RuimtePulsar

public enum UiInterpreterError: Error, Sendable {
    case unavailable
    case invalid(String)
    case tooLarge
}

public actor UiInterpreter {
    public static let shared = UiInterpreter()
    private var context: JSContext?

    public init() {}

    public func evaluate(block: JSONValue, values: JSONValue = .object([:]), queries: JSONValue = .object([:]), change: JSONValue? = nil) throws -> JSONValue {
        try Task.checkCancellation()
        var request: [String: JSONValue] = ["block": block, "values": values, "queries": queries]
        if let change { request["change"] = change }
        let data = try JSONValue.object(request).encoded()
        guard data.count <= 1024 * 1024 else { throw UiInterpreterError.tooLarge }
        let engine = try engine()
        engine.exception = nil
        // Agent strings are JSON arguments; only this bundled interpreter is executable JavaScript.
        let rendered = engine.objectForKeyedSubscript("ruimteEvaluateUi")?.call(withArguments: [String(decoding: data, as: UTF8.self)])
        guard engine.exception == nil, let json = rendered?.toString() else {
            throw UiInterpreterError.invalid(engine.exception?.toString() ?? "Invalid UI result")
        }
        guard json.utf8.count <= 1024 * 1024 else { throw UiInterpreterError.tooLarge }
        try Task.checkCancellation()
        return try JSONValue.decode(Data(json.utf8))
    }

    private func engine() throws -> JSContext {
        if let context { return context }
        guard let url = Bundle.module.url(forResource: "intelligent-ui", withExtension: "js"), let engine = JSContext() else {
            throw UiInterpreterError.unavailable
        }
        engine.evaluateScript(try String(contentsOf: url, encoding: .utf8))
        guard engine.exception == nil, engine.objectForKeyedSubscript("ruimteEvaluateUi")?.isObject == true else {
            throw UiInterpreterError.unavailable
        }
        context = engine
        return engine
    }
}
