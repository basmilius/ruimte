import RuimtePulsar
import Testing

@testable import RuimteTransport

struct NotificationApprovalTests {
    private func alert(target: PushAlertContentTarget = .chat) -> PushAlertContent {
        PushAlertContent(
            kind: .approval, target: target, nodeId: "n", title: "Approve", body: "Command", requestId: "r",
            expiresAt: 100)
    }
    @Test func onlyAnUnexpiredPendingChatRequestCanBeAnswered() throws {
        let pending: JSONValue = .object([
            "items": .array([
                .object(["kind": .string("approval"), "requestId": .string("r"), "decision": .string("pending")])
            ])
        ])
        #expect(
            try NotificationApproval.chatPayload(alert: alert(), snapshot: pending, decision: .allow, now: 10)["decision"]
                == .string("allow"))
        #expect(throws: (any Error).self) {
            try NotificationApproval.chatPayload(alert: alert(), snapshot: pending, decision: .allow, now: 100)
        }
        #expect(throws: (any Error).self) {
            try NotificationApproval.chatPayload(
                alert: alert(target: .terminal), snapshot: pending, decision: .allow, now: 10)
        }
        for decision in ["deny", "cancelled", "allow"] {
            let settled: JSONValue = .object([
                "items": .array([
                    .object(["kind": .string("approval"), "requestId": .string("r"), "decision": .string(decision)])
                ])
            ])
            #expect(throws: (any Error).self) {
                try NotificationApproval.chatPayload(alert: alert(), snapshot: settled, decision: .allow, now: 10)
            }
        }
    }
    @Test func approvalOutsideTheHistoryPageCanStillBeAnswered() throws {
        let snapshot: JSONValue = .object([
            "items": .array([]),
            "pending": .array([
                .object(["kind": .string("approval"), "requestId": .string("r"), "decision": .string("pending")])
            ]),
        ])
        #expect(
            try NotificationApproval.chatPayload(alert: alert(), snapshot: snapshot, decision: .deny, now: 10)["decision"]
                == .string("deny"))
    }

    @Test func alwaysAllowGoesOnlyWhereThePushOfferedIt() throws {
        let pending: JSONValue = .object([
            "items": .array([
                .object(["kind": .string("approval"), "requestId": .string("r"), "decision": .string("pending")])
            ])
        ])
        #expect(throws: (any Error).self) {
            try NotificationApproval.chatPayload(alert: alert(), snapshot: pending, decision: .allowAlways, now: 10)
        }
        let offered = PushAlertContent(
            kind: .approval, target: .chat, nodeId: "n", title: "Approve", body: "Command", requestId: "r",
            choices: [
                PushAlertContentChoicesItem(id: "allow", kind: .allow, label: "Allow"),
                PushAlertContentChoicesItem(id: "allow-always", kind: .remember, label: "Always allow"),
                PushAlertContentChoicesItem(id: "deny", kind: .deny, label: "Deny"),
            ], expiresAt: 100)
        #expect(
            try NotificationApproval.chatPayload(alert: offered, snapshot: pending, decision: .allowAlways, now: 10)[
                "decision"] == .string("allow-always"))
        #expect(NotificationDecision(actionIdentifier: "ruimte.allow-always") == .allowAlways)
        #expect(NotificationDecision(actionIdentifier: "com.apple.UNNotificationDefaultActionIdentifier") == nil)
    }
}
