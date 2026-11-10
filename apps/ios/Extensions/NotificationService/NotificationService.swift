import Foundation
import RuimtePulsar
import RuimteShared
@preconcurrency import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    private var completion: ((UNNotificationContent) -> Void)?
    private var fallback: UNNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        completion = contentHandler
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        content.title = "Ruimte"
        content.body = String(localized: "Open Ruimte to see the latest update.")
        content.categoryIdentifier = ""
        fallback = content
        do {
            guard let raw = request.content.userInfo[NotificationKeys.envelope] else { throw PushCryptoError.invalid }
            let envelope = try JSONValue.decode(JSONSerialization.data(withJSONObject: raw))
            let store = try SharedPushStore()
            guard let context = try store.context() else { throw PushCryptoError.wrongDevice }
            let now = Date().timeIntervalSince1970 * 1000
            let alert = try store.key().decrypt(
                envelope, handle: context.handle, machinePublicKeys: context.machinePublicKeys, now: now)
            guard let id = envelope["id"]?.stringValue, let expires = envelope["expiresAt"]?.numberValue else {
                throw PushCryptoError.invalid
            }
            let machineID = envelope["machineId"]?.stringValue ?? ""
            let nodeKey = try PushReplayLedger.nodeKey(machineID: machineID, nodeID: alert.nodeId)
            let receiptKey = try PushReplayLedger.nodeKey(machineID: machineID, nodeID: id)
            let unseen = try store.claim(
                id: receiptKey, expiresAt: expires, now: now, unseenNode: nodeKey,
                issuedAt: envelope["issuedAt"]?.numberValue)
            content.badge = NSNumber(value: unseen)
            content.userInfo[NotificationKeys.seenKey] = nodeKey
            content.userInfo[NotificationKeys.issuedAt] = envelope["issuedAt"]?.numberValue
            if alert.kind == .approval || alert.timeSensitive == true { content.interruptionLevel = .timeSensitive }
            content.title = alert.title
            content.body = Self.body(alert, now: Date())
            content.threadIdentifier = envelope["machineId"]?.stringValue ?? "ruimte"
            if alert.kind == .approval, alert.choices?.contains(where: { $0.kind == .allow }) == true,
                alert.choices?.contains(where: { $0.kind == .deny }) == true
            {
                let remembers = alert.choices?.contains(where: { $0.kind == .remember }) == true
                content.categoryIdentifier = remembers ? NotificationCategory.approvalRemember : NotificationCategory.approval
            }
            finish(content)
        } catch {
            content.sound = nil
            finish(content)
        }
    }
    /// The machine writes no time, so a usage limit's push says here when it lifts, in the phone's language and region.
    private static func body(_ alert: PushAlertContent, now: Date) -> String {
        guard let resetsAt = alert.resetsAt else { return alert.body }
        let date = Date(timeIntervalSince1970: Double(resetsAt) / 1000)
        let moment = Format.isSameDay(date, now) ? Format.clock(date) : Format.weekdayClock(date)
        return "\(alert.body) \(String(localized: "Lifts \(moment)."))"
    }
    override func serviceExtensionTimeWillExpire() { if let fallback { finish(fallback) } }
    private func finish(_ content: UNNotificationContent) {
        let handler = completion
        completion = nil
        handler?(content)
    }
}
