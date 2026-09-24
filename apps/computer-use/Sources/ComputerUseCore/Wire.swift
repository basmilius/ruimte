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
    /// The `presence` state: one of `PhantomState.presenceStates`.
    public var state: String?
    /// Words beside the cursor for a `presence` state, instead of the default for it.
    public var label: String?
    /// The step line of the menu bar item for a `presence` state.
    public var step: String?

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
    /// A stable name for a refusal a caller branches on; the message is for people and may be reworded.
    public let code: String?

    public init(_ message: String, code: String? = nil) {
        self.message = message
        self.code = code
    }

    public static let stopped = AgentError("stopped by the person (⌥⎋ or the stop button). Run `cu state <app>` to continue.", code: "stopped")
    public static let paused = AgentError("the person paused the session; wait until they resume", code: "paused")
    public static let takenOver = AgentError("the person took over; wait until they resume", code: "taken-over")
}
