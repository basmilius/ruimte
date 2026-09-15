import Foundation
import RuimtePulsar

public enum NotificationApproval {
    public static func chatPayload(
        alert: PushAlertContent, snapshot: JSONValue, allow: Bool, now: Double = Date().timeIntervalSince1970 * 1000
    ) throws -> JSONValue {
        guard alert.kind == .approval, alert.target == .chat, Double(alert.expiresAt) > now,
            let requestID = alert.requestId,
            snapshot["items"]?.arrayValue?.contains(where: {
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
    public static func terminalPayload(
        alert: PushAlertContent, snapshot: JSONValue, allow: Bool, now: Double = Date().timeIntervalSince1970 * 1000
    ) throws -> JSONValue {
        guard alert.kind == .approval, alert.target == .terminal, Double(alert.expiresAt) > now,
            let requestID = alert.requestId,
            let session = snapshot["sessions"]?.arrayValue?.first(where: { $0["sessionId"] == .string(alert.nodeId) }),
            let request = session["approvals"]?.arrayValue?.first(where: { $0["requestId"] == .string(requestID) }),
            let expires = request["expiresAt"]?.numberValue, expires > now,
            let choice = request["choices"]?.arrayValue?.first(where: {
                $0["kind"] == .string(allow ? "allow" : "deny")
            }),
            let choiceID = choice["id"]?.stringValue
        else { throw PushCryptoError.expired }
        return try WireRequest.agentAnswerApproval.validatePayload(
            .object([
                "sessionId": .string(alert.nodeId), "requestId": .string(requestID), "choiceId": .string(choiceID),
            ]))
    }
}
