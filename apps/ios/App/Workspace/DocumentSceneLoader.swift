import Foundation
import JavaScriptCore
import RuimtePulsar
import RuimteTransport

@MainActor
enum DocumentSceneLoader {
    static func load(client: any MachineRequesting, projectID: String, viewID: String, kind: String) async throws
        -> JSONValue
    {
        guard ["drawing", "diagram"].contains(kind) else {
            throw MachineClientError.invalid("Unsupported document kind.")
        }
        let payload: JSONValue = .object(["projectId": .string(projectID), "viewId": .string(viewID)])
        do {
            return try await client.request(kind == "drawing" ? "drawing.paths" : "diagram.layout", payload: payload)
        } catch MachineClientError.server(let code, _) where code == "unknown-request" {
            let result = try await client.request(kind + ".open", payload: payload)
            try Task.checkCancellation()
            guard let document = result["document"] else {
                throw MachineClientError.invalid("The machine did not return a document.")
            }
            return try await LocalDocumentRenderer.shared.render(kind: kind, document: document)
        }
    }
}

actor LocalDocumentRenderer {
    static let shared = LocalDocumentRenderer()
    private var context: JSContext?

    func render(kind: String, document: JSONValue) throws -> JSONValue {
        try Task.checkCancellation()
        guard ["drawing", "diagram"].contains(kind) else {
            throw MachineClientError.invalid("Unsupported document kind.")
        }
        let openRequest: WireRequest = kind == "drawing" ? .drawingOpen : .diagramOpen
        _ = try openRequest.validateResult(.object(["document": document]))
        let data = try document.encoded()
        guard data.count <= 8 * 1024 * 1024 else {
            throw MachineClientError.invalid("This document is too large to render on this device.")
        }
        let engine = try engine()
        engine.exception = nil
        // Only the bundled renderer executes; document contents are passed as JSON arguments, never JavaScript source.
        let rendered = engine.objectForKeyedSubscript("ruimteRenderDocument")?.call(withArguments: [
            kind, String(decoding: data, as: UTF8.self),
        ])
        guard engine.exception == nil, let json = rendered?.toString(), let resultData = json.data(using: .utf8) else {
            throw MachineClientError.invalid("This document could not be rendered.")
        }
        try Task.checkCancellation()
        let result = try JSONValue.decode(resultData)
        return try (kind == "drawing" ? WireRequest.drawingPaths : .diagramLayout).validateResult(result)
    }

    private func engine() throws -> JSContext {
        if let context { return context }
        guard let url = Bundle.main.url(forResource: "document-renderer", withExtension: "js"), let engine = JSContext()
        else {
            throw MachineClientError.invalid("The document renderer is unavailable.")
        }
        engine.evaluateScript(try String(contentsOf: url, encoding: .utf8))
        guard engine.exception == nil, engine.objectForKeyedSubscript("ruimteRenderDocument")?.isObject == true else {
            throw MachineClientError.invalid("The document renderer could not be loaded.")
        }
        context = engine
        return engine
    }
}
