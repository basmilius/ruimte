import Foundation
import RuimtePulsar

public enum NotificationApproval {
    public static func chatPayload(
        alert: PushAlertContent, snapshot: JSONValue, allow: Bool, now: Double = Date().timeIntervalSince1970 * 1000
    ) throws -> JSONValue {
        guard alert.kind == .approval, alert.target == .chat, Double(alert.expiresAt) > now,
            let requestID = alert.requestId,
            ((snapshot["items"]?.arrayValue ?? []) + (snapshot["pending"]?.arrayValue ?? [])).contains(where: {
                $0["kind"] == .string("approval") && $0["requestId"] == .string(requestID)
                    && $0["decision"] == .string("pending")
            }) == true
        else { throw PushCryptoError.expired }
        return try WireRequest.chatApprove.validatePayload(
            .object([
                "chatId": .string(alert.nodeId), "requestId": .string(requestID),
                "decision": .string(allow ? "allow" : "deny"),
            ]))
    }
}
