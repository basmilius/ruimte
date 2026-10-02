import Foundation
import Testing

@testable import RuimtePulsar

private func decode(_ json: String) throws -> JSONValue { try JSONValue.decode(Data(json.utf8)) }

private let threeClaudes = """
    {
        "accounts": {
            "claude": { "kind": "claude" },
            "work": { "kind": "claude", "label": "Work" },
            "spare": { "kind": "claude", "label": "Spare" },
            "off": { "kind": "claude", "enabled": false },
            "out": { "kind": "claude" }
        },
        "statuses": [
            { "id": "claude", "kind": "claude", "state": "ready" },
            { "id": "work", "kind": "claude", "state": "ready" },
            { "id": "spare", "kind": "claude", "state": "ready" },
            { "id": "off", "kind": "claude", "state": "ready" },
            { "id": "out", "kind": "claude", "state": "signed-out" }
        ]
    }
    """

private func window(_ kind: String, _ used: Double, resetsAt: Double? = nil) -> String {
    let reset = resetsAt.map { "\($0)" } ?? "null"
    return """
        { "id": "\(kind)", "kind": "\(kind)", "label": "\(kind)", "used": \(used), "resetsAt": \(reset), "durationMs": null }
        """
}

private func entry(_ id: String?, checkedAt: Double = 1, windows: [String], unavailable: Bool = false) -> String {
    let account = id.map { #""account": { "id": "\#($0)" },"# } ?? ""
    let missing = unavailable ? #"{ "reason": "failed", "message": null }"# : "null"
    return """
        { "kind": "claude", \(account) "plan": null, "checkedAt": \(checkedAt), "source": "probe",
          "windows": [\(windows.joined(separator: ","))], "cost": null, "unavailable": \(missing) }
        """
}

private func limits(_ entries: [String]) throws -> JSONValue {
    try decode(#"{ "providers": [\#(entries.joined(separator: ","))] }"#)
}

@Test func aChatGoesOnUnderTheAccountWithTheLeastOfItsSessionSpent() throws {
    let accounts = ProviderAccountList(try decode(threeClaudes))
    let snapshot = try limits([
        entry(nil, windows: [window("session", 1)]),
        entry("work", windows: [window("session", 0.6), window("weekly", 0.1)]),
        entry("spare", windows: [window("session", 0.2), window("weekly", 0.9)]),
    ])
    #expect(accounts.continueTarget("claude", current: nil, limits: snapshot)?.id == "spare")
    #expect(accounts.continueTarget("claude", current: "spare", limits: snapshot)?.id == "work")
}

@Test func anAccountWithASpentWindowOrNoNumbersIsNoTarget() throws {
    let accounts = ProviderAccountList(try decode(threeClaudes))
    let snapshot = try limits([
        entry("work", windows: [window("session", 0.1), window("weekly", 1)]),
        entry("spare", checkedAt: 0, windows: [window("session", 0.1)]),
        entry("off", windows: [window("session", 0)]),
        entry("out", windows: [window("session", 0)]),
    ])
    #expect(accounts.continueTarget("claude", current: nil, limits: snapshot) == nil)
    let failed = try limits([entry("work", windows: [window("session", 0.1)], unavailable: true)])
    #expect(accounts.continueTarget("claude", current: nil, limits: failed) == nil)
    #expect(accounts.continueTarget("claude", current: nil, limits: nil) == nil)
}

@Test func anAccountNotReadYetIsAskedFor() throws {
    let accounts = ProviderAccountList(try decode(threeClaudes))
    let snapshot = try limits([entry("work", windows: [window("session", 0.1)])])
    #expect(accounts.hasUnreadAccount("claude", current: nil, limits: snapshot))
    let both = try limits([
        entry("work", windows: [window("session", 0.1)]), entry("spare", windows: [window("session", 0.1)]),
    ])
    #expect(!accounts.hasUnreadAccount("claude", current: nil, limits: both))
}

@Test func theSessionWindowOfAnAccountIsReadFromItsEntry() throws {
    let snapshot = try limits([
        entry(nil, windows: [window("weekly", 0.3), window("session", 0.45, resetsAt: 1_700_000_000_000)]),
        entry("work", windows: [window("weekly", 0.3)]),
    ])
    #expect(
        ProviderAccountList.sessionWindow(snapshot, account: "claude")
            == AccountSessionWindow(used: 0.45, resetsAt: 1_700_000_000_000))
    #expect(ProviderAccountList.sessionWindow(snapshot, account: "work") == nil)
}
