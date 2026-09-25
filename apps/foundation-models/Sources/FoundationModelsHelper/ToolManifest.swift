import CryptoKit
import Foundation
import FoundationModels

enum ToolManifest {
    private struct Definition: Encodable {
        let name: String
        let description: String
        let parameters: GenerationSchema
        let includesSchemaInInstructions: Bool
    }

    static func fingerprint(_ tools: [any Tool]) throws -> String {
        let definitions = tools.map { Definition(name: $0.name, description: $0.description, parameters: $0.parameters, includesSchemaInInstructions: $0.includesSchemaInInstructions) }
            .sorted { $0.name < $1.name }
        guard Set(definitions.map(\.name)).count == definitions.count else {
            throw SessionStoreError(description: "Duplicate Apple tool names are not allowed.")
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return SHA256.hash(data: try encoder.encode(definitions)).map { String(format: "%02x", $0) }.joined()
    }
}
