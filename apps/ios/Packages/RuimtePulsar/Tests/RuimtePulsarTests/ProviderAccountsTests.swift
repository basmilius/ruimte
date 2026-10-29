import Foundation
import Testing

@testable import RuimtePulsar

private func list(_ json: String) throws -> ProviderAccountList {
    ProviderAccountList(try JSONValue.decode(Data(json.utf8)))
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

@Test func accountsNobodyPlacedPutTheDefaultFirstAndTheRestById() throws {
    var value = try #require(JSONValue.decode(Data(twoClaudes.utf8)).objectValue)
    let statuses = try #require(value["statuses"]?.arrayValue)
    value["statuses"] = .array([statuses[3], statuses[2], statuses[1], statuses[0]])
    let accounts = ProviderAccountList(.object(value))
    #expect(accounts.entries.map(\.id) == ["codex", "claude", "old", "work"])
    #expect(accounts.accounts(of: "claude").map(\.id) == ["claude", "old", "work"])
    #expect(accounts.accounts(of: "codex").map(\.id) == ["codex"])
    #expect(accounts.entries.first { $0.id == "work" }?.state == "signed-out")
    #expect(accounts.startingAccount(of: "claude")?.id == "claude")
}

@Test func accountsFollowTheirPlaces() {
    let accounts = ProviderAccountList(entries: [
        ProviderAccountEntry(id: "claude", kind: "claude", order: 2),
        ProviderAccountEntry(id: "work", kind: "claude", order: 0),
        ProviderAccountEntry(id: "home", kind: "claude", order: 1),
    ])
    #expect(accounts.accounts(of: "claude").map(\.id) == ["work", "home", "claude"])
    #expect(accounts.startingAccount(of: "claude")?.id == "work")
}

@Test func aPlacedAccountGoesAboveTheDefaultAndTheUnplacedFollowIt() throws {
    let accounts = try list(
        """
        {
            "accounts": {
                "claude": { "kind": "claude" },
                "b": { "kind": "claude" },
                "a": { "kind": "claude" },
                "work": { "kind": "claude", "order": 0, "enabled": false },
                "home": { "kind": "claude", "order": 1 }
            },
            "statuses": []
        }
        """)
    #expect(accounts.accounts(of: "claude").map(\.id) == ["work", "home", "claude", "a", "b"])
    #expect(accounts.startingAccount(of: "claude")?.id == "home")
}

@Test func aDefaultAccountNobodyNamedGoesByItsCLIsName() throws {
    let accounts = try list(twoClaudes)
    #expect(accounts.accounts(of: "claude").map { $0.name(provider: "Claude") } == ["Claude", "Old", "Work"])
    #expect(ProviderAccountEntry(id: "claude_x", kind: "claude").name(provider: "Claude") == "claude_x")
}

@Test func aChoiceTakesTwoAccountsThatAreOn() throws {
    let accounts = try list(twoClaudes)
    #expect(accounts.hasChoice("claude"))
    #expect(!accounts.hasChoice("codex"))
    let one = ProviderAccountList(entries: [
        ProviderAccountEntry(id: "claude", kind: "claude"),
        ProviderAccountEntry(id: "off", kind: "claude", enabled: false),
    ])
    #expect(!one.hasChoice("claude"))
}

@Test func aPickerOffersTheAccountsThatAreOnAndTheOneInUse() throws {
    let accounts = try list(twoClaudes)
    #expect(accounts.offered("claude", current: nil).map(\.id) == ["claude", "work"])
    #expect(accounts.offered("claude", current: "old").map(\.id) == ["claude", "old", "work"])
}

@Test func aChatGoesOnOnlyUnderAnAccountThatReadsItsConversation() throws {
    let accounts = try list(twoClaudes)
    #expect(accounts.canContinue("claude", from: nil, to: "claude"))
    #expect(accounts.canContinue("claude", from: nil, to: "old"))
    #expect(!accounts.canContinue("claude", from: nil, to: "work"))
    #expect(!accounts.canContinue("claude", from: "work", to: nil))
    #expect(!accounts.canContinue("codex", from: nil, to: "claude"))
    let crossKind = ProviderAccountList(entries: [
        ProviderAccountEntry(id: "codex", kind: "codex", transcripts: "/shared/conversations"),
        ProviderAccountEntry(id: "claude", kind: "claude", transcripts: "/shared/conversations"),
    ])
    #expect(!crossKind.canContinue("codex", from: nil, to: "claude"))
    #expect(!crossKind.canContinue("codex", from: "claude", to: nil))
    let silent = ProviderAccountList(entries: [
        ProviderAccountEntry(id: "codex", kind: "codex"), ProviderAccountEntry(id: "second", kind: "codex"),
    ])
    #expect(!silent.canContinue("codex", from: nil, to: "second"))
}

@Test func aChatHasStartedOnceItHasASessionOrATurn() {
    func info(session: String?, turns: Int64) -> ChatInfo {
        ChatInfo(
            chatId: "chat", provider: "claude", cwd: "/work", agentSessionId: session, model: nil,
            selection: ChatInfoSelection(model: "opus", options: [:]), runtimeMode: "supervised", status: "idle",
            running: false, activeTurnId: nil, slashCommands: [],
            usage: ChatInfoUsage(contextTokens: 0, contextWindow: nil, costUsd: 0, turns: turns), createdAt: 0)
    }
    #expect(!ProviderAccountList.chatStarted(info(session: nil, turns: 0)))
    #expect(ProviderAccountList.chatStarted(info(session: "abc", turns: 0)))
    #expect(ProviderAccountList.chatStarted(info(session: nil, turns: 2)))
}

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
            """.utf8))
    let sections = UsageLimitSection.sections(limits: limits, accounts: try list(twoClaudes))
    #expect(sections.map(\.id) == ["claude", "work", "codex"])
    #expect(sections.map(\.title) == ["Claude limits · Claude", "Claude limits · Work", "Codex limits"])
    #expect(sections.map(\.quiet) == [nil, .signedOut, .notRead(message: nil)])
    #expect(sections[1].color == "pink")
    #expect(sections[1].entry == nil)
}

@Test func limitsFromAMachineBeforeAccountsKeepOneSectionPerCLI() throws {
    let limits = JSONValue.object([
        "providers": .array([
            .object(["kind": .string("claude"), "checkedAt": .number(1), "windows": .array([]), "unavailable": .null])
        ])
    ])
    let sections = UsageLimitSection.sections(limits: limits, accounts: nil)
    #expect(sections.map(\.title) == ["Claude limits"])
    #expect(sections.first?.quiet == nil)
}
