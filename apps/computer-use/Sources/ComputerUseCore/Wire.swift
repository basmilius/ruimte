import Foundation

/// One command to the helper. The reply is `{"ok": true, "result": {...}}` or `{"ok": false, "error": "..."}`.
public struct Request: Codable, Sendable {
    /// The content of `$RUIMTE_HOME/local.key`; a request without it is refused before anything else is read.
    public var secret: String?
    public var command: String
    public var app: String?
    public var element: Int?
    public var x: Double?
    public var y: Double?
    public var count: Int?
    public var text: String?
    public var value: String?
    public var combos: [String]?
    public var prompt: Bool?
    public var maxDepth: Int?
    public var maxElements: Int?
    public var screenshot: Bool?
    public var maxText: Int?
    public var button: String?
    public var direction: String?
    public var pages: Double?
    /// A menu index or a path such as "File > Save".
    public var path: String?
    /// Wait for the UI to settle after the action and answer with a fresh state.
    public var withState: Bool?

    public init(command: String) {
        self.command = command
    }
}

/// Only the secret, so a request is authenticated before the rest of it is trusted to decode.
public struct Credential: Decodable, Sendable {
    public var secret: String?
}

public struct AgentError: Error, Sendable {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    public static let stopped = AgentError("stopped by the user (Esc). Run `cu state <app>` to continue.")
}
