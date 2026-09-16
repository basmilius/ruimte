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
            try NotificationApproval.chatPayload(alert: alert(), snapshot: pending, allow: true, now: 10)["decision"]
                == .string("allow"))
        #expect(throws: (any Error).self) {
            try NotificationApproval.chatPayload(alert: alert(), snapshot: pending, allow: true, now: 100)
        }
        #expect(throws: (any Error).self) {
            try NotificationApproval.chatPayload(
                alert: alert(target: .terminal), snapshot: pending, allow: true, now: 10)
        }
        for decision in ["deny", "cancelled", "allow"] {
            let settled: JSONValue = .object([
                "items": .array([
                    .object(["kind": .string("approval"), "requestId": .string("r"), "decision": .string(decision)])
                ])
            ])
            #expect(throws: (any Error).self) {
                try NotificationApproval.chatPayload(alert: alert(), snapshot: settled, allow: true, now: 10)
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
            try NotificationApproval.chatPayload(alert: alert(), snapshot: snapshot, allow: false, now: 10)["decision"]
                == .string("deny"))
    }

    @Test func terminalActionUsesFreshChoiceAndSessionIdentity() throws {
        let request: JSONValue = .object([
            "requestId": .string("r"), "expiresAt": .number(80),
            "choices": .array([.object(["id": .string("fresh-choice"), "kind": .string("deny")])]),
        ])
        let snapshot: JSONValue = .object([
            "sessions": .array([.object(["sessionId": .string("n"), "approvals": .array([request])])])
        ])
        #expect(
            try NotificationApproval.terminalPayload(
                alert: alert(target: .terminal), snapshot: snapshot, allow: false, now: 10)["choiceId"]
                == .string("fresh-choice"))
        #expect(throws: (any Error).self) {
            try NotificationApproval.terminalPayload(
                alert: alert(target: .terminal), snapshot: snapshot, allow: true, now: 10)
        }
        #expect(throws: (any Error).self) {
            try NotificationApproval.terminalPayload(
                alert: alert(target: .terminal), snapshot: snapshot, allow: false, now: 80)
        }
        let other: JSONValue = .object([
            "sessions": .array([.object(["sessionId": .string("other"), "approvals": .array([request])])])
        ])
        #expect(throws: (any Error).self) {
            try NotificationApproval.terminalPayload(
                alert: alert(target: .terminal), snapshot: other, allow: false, now: 10)
        }
    }
}
