/// What the app and the Notification Service extension both read or write on a notification. Each target compiles its
/// own copy, so a key written by one is the key the other looks for.
enum NotificationKeys {
    /// The sealed envelope the daemon's push carries.
    static let envelope = "ruimte"
    /// The node a notification belongs to, written once the extension opened the envelope.
    static let seenKey = "ruimte.seenKey"
    static let issuedAt = "ruimte.issuedAt"
}

enum NotificationCategory {
    static let approval = "ruimte.approval"
    static let approvalRemember = "ruimte.approval.remember"
}
