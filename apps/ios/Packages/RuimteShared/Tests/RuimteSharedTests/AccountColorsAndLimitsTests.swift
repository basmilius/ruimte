import Foundation
import RuimtePulsar
import Testing

@testable import RuimteShared

private func list(_ json: String) throws -> ProviderAccountList {
    let value = try JSONValue.decode(Data(json.utf8))
    var object = try #require(value.objectValue)
    let defaults: [String: JSONValue] = [
        "email": .null, "plan": .null, "organization": .null, "home": .string("/home"), "message": .null,
        "checkedAt": .number(0),
    ]
    object["statuses"] = .array(
        (object["statuses"]?.arrayValue ?? []).map { status in
            .object(defaults.merging(status.objectValue ?? [:]) { _, given in given })
        })
    return ProviderAccountList(try JSONValue.object(object).decoded(as: AccountsSnapshot.self))
}

private let twoClaudes = """
    {
        "accounts": {
            "work": { "kind": "claude", "label": "Work", "color": "pink" },
            "claude": { "kind": "claude" },
            "codex": { "kind": "codex" },
            "old": { "kind": "claude", "label": "Old", "enabled": false }
        },
        "statuses": [
            { "id": "claude", "kind": "claude", "state": "ready", "transcripts": "/home/.claude/projects" },
            { "id": "old", "kind": "claude", "state": "ready", "transcripts": "/home/.claude/projects" },
            { "id": "work", "kind": "claude", "state": "signed-out", "transcripts": "/ruimte/accounts/work/projects" },
            { "id": "codex", "kind": "codex", "state": "ready" }
        ]
    }
    """

@Test func anAccountWearsANodeAccentOrNone() {
    #expect(RuimteColors.nodeAccents["blue"] == 0x155dfc)
    #expect(RuimteColors.nodeAccent("gray") == nil)
    #expect(RuimteColors.nodeAccent(nil) == nil)
}

@Test func limitsGetASectionPerAccountAndNameItOnlyWhenACLIHasSeveral() throws {
    let limits = try JSONValue.decode(
        Data(
            """
            {
                "providers": [
                    { "kind": "claude", "account": { "id": "claude", "label": "Claude" }, "plan": "max", "checkedAt": 5,
                      "source": "probe", "windows": [{ "id": "s", "kind": "session", "label": "Session", "used": 0.4,
                      "resetsAt": null, "durationMs": null }], "cost": null, "unavailable": null },
                    { "kind": "codex", "account": { "id": "codex", "label": "Codex" }, "plan": null, "checkedAt": 0,
                      "source": "probe", "windows": [], "cost": null, "unavailable": null }
                ]
            }
            """.utf8)
    ).decoded(as: UsageLimits.self)
    let sections = UsageLimitSection.sections(limits: limits, accounts: try list(twoClaudes))
    #expect(sections.map(\.id) == ["claude", "work", "codex"])
    #expect(sections.map(\.title) == ["Claude limits · Claude", "Claude limits · Work", "Codex limits"])
    #expect(sections.map(\.quiet) == [nil, .signedOut, .notRead(message: nil)])
    #expect(sections[1].color == "pink")
    #expect(sections[1].entry == nil)
}

@Test func limitsFromAMachineBeforeAccountsKeepOneSectionPerCLI() throws {
    let limits = UsageLimits(providers: [
        UsageLimitsProvider(
            kind: "claude", account: nil, plan: nil, checkedAt: 1, source: .probe, windows: [], cost: nil,
            unavailable: nil)
    ])
    let sections = UsageLimitSection.sections(limits: limits, accounts: nil)
    #expect(sections.map(\.title) == ["Claude limits"])
    #expect(sections.first?.quiet == nil)
}
