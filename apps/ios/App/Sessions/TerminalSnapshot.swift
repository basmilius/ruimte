import RuimtePulsar
import RuimteTransport

@MainActor
enum TerminalSnapshot {
    static func load(
        attachment: MachineAttachment, client: any MachineRequesting, sessionID: String,
        onSnapshot: @escaping @MainActor @Sendable (JSONValue) -> Void
    ) async throws -> JSONValue {
        var payload: [String: JSONValue] = ["sessionId": .string(sessionID), "follow": .bool(true)]
        do {
            return try await attachment.snapshot(payload: .object(payload), onSnapshot: onSnapshot)
        } catch MachineClientError.server(let code, _) where code == "bad-request" {
            // Older daemons require dimensions; borrow their current size instead of the phone's viewport.
            let result = try await client.request("session.list")
            try Task.checkCancellation()
            guard let session = result["sessions"]?.arrayValue?.first(where: { $0["sessionId"] == .string(sessionID) })
            else {
                throw MachineClientError.server(code: "not-found", message: "This terminal is no longer available.")
            }
            for dimension in ["cols", "rows"] {
                guard let value = session[dimension]?.numberValue, value.isFinite, value > 0, value.rounded() == value
                else { throw MachineClientError.invalid("The machine did not report a valid terminal size.") }
                payload[dimension] = .number(value)
            }
            return try await attachment.snapshot(payload: .object(payload), onSnapshot: onSnapshot)
        }
    }
}
