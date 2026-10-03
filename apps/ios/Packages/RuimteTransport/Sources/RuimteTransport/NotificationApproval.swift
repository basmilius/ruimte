import Foundation
import RuimtePulsar

/// A decision taken from a notification's actions.
public enum NotificationDecision: String, Sendable {
    case allow
    case allowAlways = "allow-always"
    case deny

    /// The action a notification category offers for it.
    public var actionIdentifier: String { "ruimte.\(rawValue)" }

    public init?(actionIdentifier: String) {
        guard actionIdentifier.hasPrefix("ruimte."),
            let decision = Self(rawValue: String(actionIdentifier.dropFirst("ruimte.".count)))
        else { return nil }
        self = decision
    }
}

public enum NotificationApproval {
    /// Always allow is only sent where the push offered it, which the machine does when the CLI can remember the rule.
    public static func chatPayload(
        alert: PushAlertContent, snapshot: JSONValue, decision: NotificationDecision,
        now: Double = Date().timeIntervalSince1970 * 1000
    ) throws -> JSONValue {
        guard alert.kind == .approval, alert.target == .chat, Double(alert.expiresAt) > now,
            let requestID = alert.requestId,
            decision != .allowAlways || alert.choices?.contains(where: { $0.kind == .remember }) == true,
            ((snapshot["items"]?.arrayValue ?? []) + (snapshot["pending"]?.arrayValue ?? [])).contains(where: {
                $0["kind"] == .string("approval") && $0["requestId"] == .string(requestID)
                    && $0["decision"] == .string("pending")
            }) == true
        else { throw PushCryptoError.expired }
        return try WireRequest.chatApprove.validatePayload(
            .object([
                "chatId": .string(alert.nodeId), "requestId": .string(requestID),
                "decision": .string(decision.rawValue),
            ]))
    }
}
