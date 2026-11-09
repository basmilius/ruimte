import Foundation
import RuimtePulsar

@testable import Ruimte

/// Chat payloads as a machine sends them. A test names only the fields it is about; the rest takes the defaults of the
/// item's kind, so the thread decodes into the generated types as a real one does.
enum ChatWire {
    static func item(_ fields: [String: JSONValue]) -> JSONValue {
        let id = fields["id"]?.stringValue ?? "item"
        let defaults: [String: JSONValue]
        switch fields["kind"]?.stringValue {
        case "user": defaults = ["text": .string("")]
        // A settled reply without words has no row, so the default has some.
        case "assistant": defaults = ["text": .string("Reply."), "streaming": .bool(false)]
        case "thinking": defaults = ["text": .string(""), "streaming": .bool(false), "endedAt": .null]
        case "tool":
            defaults = [
                "toolUseId": .string("use-\(id)"), "name": .string("Read"), "input": .null, "output": .null,
                "state": .string("done"), "parentToolUseId": .null,
            ]
        case "subagent":
            defaults = [
                "toolUseId": .string("use-\(id)"), "description": .string(""), "subagentType": .null, "prompt": .null,
                "background": .bool(false), "status": .string("running"), "startedAt": .number(0),
                "finishedAt": .null, "summary": .null, "result": .null, "usage": .null, "lastTool": .null,
                "itemsTruncated": .bool(false),
            ]
        case "approval":
            defaults = [
                "requestId": .string("request-\(id)"), "toolUseId": .null, "toolName": .string("Bash"),
                "input": .null, "description": .null, "canAllowAlways": .bool(false), "decision": .string("pending"),
            ]
        case "question":
            defaults = [
                "requestId": .string("request-\(id)"),
                "questions": .array([
                    .object([
                        "id": .string("question"), "header": .string(""), "question": .string("Which one?"),
                        "choices": .array([]), "multiSelect": .bool(false),
                    ])
                ]),
                "answers": .null, "state": .string("pending"),
            ]
        case "turn": defaults = ["state": .string("done"), "endedAt": .null, "costUsd": .number(0)]
        case "note": defaults = ["level": .string("info"), "text": .string("")]
        case "compaction": defaults = ["preTokens": .null]
        default: defaults = [:]
        }
        let base: [String: JSONValue] = ["id": .string(id), "createdAt": .number(0), "turnId": .null]
        return .object(base.merging(defaults) { _, kind in kind }.merging(fields) { _, given in given })
    }

    static func info(_ fields: [String: JSONValue] = [:]) -> JSONValue {
        let defaults: [String: JSONValue] = [
            "chatId": .string("chat"), "provider": .string("claude"), "cwd": .string("/work"),
            "agentSessionId": .null, "model": .null,
            "selection": .object(["model": .string("opus"), "options": .object([:])]),
            "runtimeMode": .string("supervised"), "status": .string("idle"), "running": .bool(false),
            "activeTurnId": .null, "slashCommands": .array([]),
            "usage": .object([
                "contextTokens": .number(0), "contextWindow": .null, "costUsd": .number(0), "turns": .number(0),
            ]),
            "createdAt": .number(0),
        ]
        return .object(defaults.merging(fields) { _, given in given })
    }
}

extension JSONValue {
    // A fixture that does not decode is a broken test, not a case to cover.
    var chatItem: ChatItem { try! decoded(as: ChatItem.self) }
    var chatInfo: ChatInfo { try! decoded(as: ChatInfo.self) }
    var chatTool: ChatToolItem { try! decoded(as: ChatToolItem.self) }
}

/// A checkout's status as `git.status` answers it, a clean repository on `main` for whatever a test leaves out.
enum GitWire {
    static func status(_ fields: [String: JSONValue]) -> GitStatus {
        let defaults: [String: JSONValue] = [
            "repo": .bool(true), "root": .string("/work"), "branch": .string("main"), "detached": .bool(false),
            "upstream": .null, "ahead": .number(0), "behind": .number(0), "base": .null, "mergeBase": .null,
            "files": .array([]), "truncated": .bool(false), "live": .bool(true),
        ]
        return try! JSONValue.object(defaults.merging(fields) { _, given in given }).decoded(as: GitStatus.self)
    }

    static func repo(path: String, label: String, name: String? = nil, kind: GitRepoKind = .nested) -> JSONValue {
        var fields: [String: JSONValue] = [
            "path": .string(path), "label": .string(label), "kind": .string(kind.rawValue),
        ]
        if let name { fields["name"] = .string(name) }
        return .object(fields)
    }

    static func repos(_ repos: [JSONValue], truncated: Bool = false) -> JSONValue {
        .object(["repos": .array(repos), "truncated": .bool(truncated)])
    }

    static func json(_ status: GitStatus?) -> JSONValue {
        guard let status, let data = try? JSONEncoder().encode(status) else { return .object([:]) }
        return (try? JSONValue.decode(data)) ?? .object([:])
    }
}

/// `endpoint.info` and `endpoint.changed` as a machine writes them, with the fields the schema requires and whatever a
/// test names on top.
enum EndpointWire {
    static func info(_ fields: [String: JSONValue] = [:]) -> JSONValue {
        let defaults: [String: JSONValue] = [
            "id": .string("studio"), "label": .string("Studio"), "platform": .string("darwin"),
            "version": .string("0.42.1"), "reachability": .string("lan"), "authenticated": .bool(true),
        ]
        return .object(defaults.merging(fields) { _, given in given })
    }

    static func changed(_ fields: [String: JSONValue] = [:]) -> JSONValue {
        let defaults: [String: JSONValue] = [
            "id": .string("studio"), "label": .string("Studio"), "nameSource": .string("default"), "icon": .null,
        ]
        return .object(defaults.merging(fields) { _, given in given })
    }

    static func decoded(_ info: JSONValue) -> EndpointInfo { try! info.decoded(as: EndpointInfo.self) }
}

/// `processes.*` replies and events as a machine writes them. Each builder takes what a test is about and fills in the
/// rest the way a sample reads.
enum ProcessWire {
    static func row(_ pid: Int, start: Double = 100, readable: Bool = true, cpu: Double? = 3) -> JSONValue {
        .object([
            "pid": .number(Double(pid)), "startTime": .number(start), "ppid": .number(1), "name": .string("bun"),
            "path": .null, "readable": .bool(readable), "cpu": cpu.map(JSONValue.number) ?? .null,
            "memory": .number(2048), "diskRead": .null, "diskWrite": .null, "family": .null, "depth": .number(0),
        ])
    }

    static func group(
        _ id: String, kind: String = "terminal", node: String? = nil, project: String? = nil, label: String? = nil,
        rows: [JSONValue] = []
    ) -> JSONValue {
        var fields: [String: JSONValue] = [
            "id": .string(id), "kind": .string(kind), "nodeId": node.map(JSONValue.string) ?? .null,
            "cpu": .number(3), "memory": .number(2048), "diskRead": .null, "diskWrite": .null,
            "processes": .array(rows), "hidden": .number(0),
        ]
        if let label { fields["label"] = .string(label) }
        if let project { fields["projectId"] = .string(project) }
        return .object(fields)
    }

    static func sample(scope: String, at: Double, groups: [JSONValue], point: Bool = true, reset: Bool = false)
        -> JSONValue
    {
        .object([
            "at": .number(at), "scope": .string(scope),
            "machine": .object([
                "cores": .number(8), "cpu": .number(12), "memoryUsed": .number(1), "memoryTotal": .number(2),
                "diskRead": .null, "diskWrite": .null, "diskFree": .null, "diskTotal": .null,
            ]),
            "groups": .array(groups), "fine": point ? .object(finePoint(at: at)) : .null, "coarse": .null,
            "reset": .bool(reset),
        ])
    }

    private static func finePoint(at: Double) -> [String: JSONValue] {
        [
            "at": .number(at), "cpu": .number(12), "cpuRuimte": .null, "memory": .null, "memoryRuimte": .null,
            "disk": .null, "diskRuimte": .null,
        ]
    }

    static func alert(_ kind: String, node: String? = nil, pid: Int? = nil, value: Double? = nil) -> JSONValue {
        .object([
            "id": .string("a1"), "kind": .string(kind), "nodeId": node.map(JSONValue.string) ?? .null,
            "pid": pid.map { .number(Double($0)) } ?? .null, "startTime": pid == nil ? .null : .number(100),
            "name": .string("bun"), "since": .number(0), "value": value.map(JSONValue.number) ?? .null,
        ])
    }

    static func subscribed(supported: Bool = true, sample: JSONValue = .null) -> JSONValue {
        .object([
            "supported": .bool(supported), "fineIntervalMs": .number(2000), "coarseIntervalMs": .number(300_000),
            "fine": .array([]), "coarse": .array([]), "sample": sample,
        ])
    }
}

extension JSONValue {
    var processGroup: ProcessGroup { try! decoded(as: ProcessGroup.self) }
    var processSample: ProcessSample { try! decoded(as: ProcessSample.self) }
    var processAlert: ProcessAlert { try! decoded(as: ProcessAlert.self) }
    var processSubscribed: ProcessesSubscribeResult { try! decoded(as: ProcessesSubscribeResult.self) }
}

/// `launches.*` and `launch.*` replies and events as a machine writes them, with the fields the schema requires.
enum LaunchWire {
    static func entry(
        _ id: String, kind: String = "service", command: String? = "bun dev", cwd: String? = nil,
        members: [String] = [], shared: Bool = false, extra: [String: JSONValue] = [:]
    ) -> JSONValue {
        var fields: [String: JSONValue] = [
            "id": .string(id), "name": .string(id), "kind": .string(kind), "shared": .bool(shared),
        ]
        if kind == "group" {
            fields["launches"] = .array(members.map(JSONValue.string))
        } else if let command {
            fields["command"] = .string(command)
        }
        if let cwd { fields["cwd"] = .string(cwd) }
        fields.merge(extra) { _, new in new }
        return .object(fields)
    }

    static func status(
        _ id: String, project: String = "p1", kind: String = "service", state: String, exit: Int? = nil,
        stopped: Bool = false, port: Int? = nil, endedAt: Double? = nil
    ) -> JSONValue {
        .object([
            "projectId": .string(project), "launchId": .string(id), "sessionId": .string("launch:\(id)"),
            "kind": .string(kind), "state": .string(state), "exitCode": exit.map { .number(Double($0)) } ?? .null,
            "startedAt": .number(1000),
            "endedAt": endedAt.map(JSONValue.number) ?? (state == "exited" ? .number(6000) : .null),
            "port": port.map { .number(Double($0)) } ?? .null, "url": .null, "stopped": .bool(stopped),
        ])
    }

    static func document(_ launches: [JSONValue], approved: [String], rev: Int = 3) -> JSONValue {
        .object([
            "rev": .number(Double(rev)), "launches": .array(launches),
            "approved": .array(approved.map(JSONValue.string)),
        ])
    }

    static func suggestion(
        _ launch: JSONValue, source: String = "package-json", path: String = "package.json", detail: String = "dev",
        isPrivate: Bool = false, unsupported: String? = nil
    ) -> JSONValue {
        var fields: [String: JSONValue] = [
            "launch": launch, "source": .string(source), "path": .string(path), "detail": .string(detail),
            "private": .bool(isPrivate),
        ]
        if let unsupported { fields["unsupported"] = .string(unsupported) }
        return .object(fields)
    }
}

extension JSONValue {
    var launchEntry: LaunchEntry { try! LaunchEntry(raw: self) }
    var launchStatus: LaunchStatus { try! decoded(as: LaunchStatus.self) }
    var launchBook: LaunchBook { try! decoded(as: LaunchBook.self) }
    var launchSuggestion: LaunchSuggestion { try! decoded(as: LaunchSuggestion.self) }
}

/// `git.worktree-*` replies as a machine writes them, with the fields the schema requires.
enum WorktreeWire {
    static func entry(
        _ path: String, branch: String, from: (branch: String, commit: String)? = nil, locked: Bool? = nil,
        work: JSONValue? = nil
    ) -> JSONValue {
        var fields: [String: JSONValue] = ["path": .string(path), "branch": .string(branch)]
        if let from { fields["from"] = .object(["branch": .string(from.branch), "commit": .string(from.commit)]) }
        if let locked { fields["locked"] = .bool(locked) }
        if let work { fields["work"] = work }
        return .object(fields)
    }

    static func work(changed: Int = 0, untracked: Int = 0, ahead: Int = 0, behind: Int? = nil) -> JSONValue {
        var fields: [String: JSONValue] = [
            "changed": .number(Double(changed)), "untracked": .number(Double(untracked)),
            "ahead": .number(Double(ahead)),
        ]
        if let behind { fields["behind"] = .number(Double(behind)) }
        return .object(fields)
    }

    static func list(_ worktrees: [JSONValue] = []) -> JSONValue {
        .object(["worktrees": .array(worktrees)])
    }

    /// What `git.worktree-merge` answers; a list of files makes it a merge that stopped on a conflict.
    static func merged(actionId: JSONValue, summary: String, cwd: String, conflicts: [String]? = nil) -> JSONValue {
        var fields: [String: JSONValue] = [
            "actionId": actionId, "summary": .string(summary), "output": .string(""), "cwd": .string(cwd),
        ]
        if let conflicts { fields["conflicts"] = .array(conflicts.map(JSONValue.string)) }
        return .object(fields)
    }

    static func removed(branchDeleted: Bool? = nil, branchCommit: String? = nil) -> JSONValue {
        var fields: [String: JSONValue] = [:]
        if let branchDeleted { fields["branchDeleted"] = .bool(branchDeleted) }
        if let branchCommit { fields["branchCommit"] = .string(branchCommit) }
        return .object(fields)
    }
}

extension JSONValue {
    var worktree: GitWorktree { try! decoded(as: Worktree.self) }
    var worktreeRemoved: WorktreeRemoveResult { try! decoded(as: WorktreeRemoveResult.self) }
}

/// `routine.list` entries as a machine writes them, an agent routine with what the schema requires for whatever a
/// test leaves out.
enum RoutineWire {
    static func weekly(_ days: [Int], time: String = "08:30") -> JSONValue {
        .object(["kind": .string("weekly"), "days": .array(days.map { .number(Double($0)) }), "time": .string(time)])
    }

    static func once(date: String, time: String) -> JSONValue {
        .object(["kind": .string("once"), "date": .string(date), "time": .string(time)])
    }

    static func cron(_ expression: String) -> JSONValue {
        .object(["kind": .string("cron"), "expression": .string(expression)])
    }

    static func interval(_ days: [Int], every: Int, from: String = "09:00", to: String = "17:00") -> JSONValue {
        .object([
            "kind": .string("interval"), "days": .array(days.map { .number(Double($0)) }),
            "every": .number(Double(every)), "from": .string(from), "to": .string(to),
        ])
    }

    /// `due` is in milliseconds, as the machine writes it.
    static func run(
        _ id: String, state: String, due: Double = 0, chat: String? = nil, version: Int? = nil
    ) -> JSONValue {
        var fields: [String: JSONValue] = [
            "runId": .string(id), "routineId": .string("deps"), "projectId": .string("p1"),
            "kind": .string("scheduled"), "due": .number(due), "at": .number(due), "state": .string(state),
        ]
        if let chat { fields["chatId"] = .string(chat) }
        if let version { fields["versionNumber"] = .number(Double(version)) }
        return .object(fields)
    }

    /// `pausedAt` and `next` are in milliseconds.
    static func entry(
        _ id: String, title: String? = nil, project: String = "p1", projectName: String = "ruimte",
        schedule: JSONValue? = nil, approved: Bool = true, pausedAt: Double? = nil, next: Double? = nil,
        runs: [JSONValue] = []
    ) -> JSONValue {
        var local: [String: JSONValue] = [:]
        if let pausedAt { local["pausedAt"] = .number(pausedAt) }
        return .object([
            "routine": .object([
                "id": .string(id), "title": .string(title ?? id), "schedule": schedule ?? weekly([1]),
                "outputKey": .string(id), "kind": .string("agent"), "prompt": .string("Check."),
                "provider": .string("claude"), "mode": .string("supervised"), "perRun": .string("new"),
            ]),
            "projectId": .string(project), "projectName": .string(projectName), "shared": .bool(false),
            "local": .object(local), "digest": .string("digest"), "approved": .bool(approved),
            "next": next.map(JSONValue.number) ?? .null, "runs": .array(runs),
        ])
    }
}

extension JSONValue {
    var routineEntry: RoutineEntry { try! decoded(as: RoutineEntry.self) }
    var routineSchedule: RoutineSchedule { try! decoded(as: RoutineSchedule.self) }
}

/// `artifact.*` replies as a machine writes them, with the fields the schema requires.
enum OutputWire {
    static func file(_ name: String = "summary.md", mime: String = "text/markdown", size: Double = 12) -> JSONValue {
        .object(["name": .string(name), "mime": .string(mime), "size": .number(size), "sha256": .string("abc")])
    }

    static func provenance(
        maker: String = "agent", agent: String? = nil, model: String? = nil, chat: String? = nil, turn: String? = nil
    ) -> JSONValue {
        var fields: [String: JSONValue] = ["maker": .string(maker), "machineId": .string("m1")]
        if let agent { fields["agent"] = .string(agent) }
        if let model { fields["model"] = .string(model) }
        if let chat { fields["chatId"] = .string(chat) }
        if let turn { fields["turnId"] = .string(turn) }
        return .object(fields)
    }

    static func version(
        _ id: String, number: Int = 1, at: Double = 0, files: [JSONValue]? = nil, provenance: JSONValue? = nil
    ) -> JSONValue {
        let files = files ?? [file()]
        return .object([
            "versionId": .string(id), "number": .number(Double(number)), "createdAt": .number(at),
            "files": .array(files),
            "bytes": .number(files.reduce(0) { $0 + ($1.objectValue?["size"]?.numberValue ?? 0) }),
            "provenance": provenance ?? Self.provenance(chat: "c1"), "copiedTo": .array([]),
        ])
    }

    static func summary(
        _ id: String, title: String, kind: String = "report", at: Double = 1_792_000_000_000, versionCount: Int = 3,
        latest: JSONValue? = nil
    ) -> JSONValue {
        .object([
            "artifactId": .string(id), "projectId": .string("p1"), "projectName": .string("ruimte"),
            "title": .string(title), "kind": .string(kind), "createdAt": .number(at),
            "latest": latest ?? version("\(id)-3", number: 3, at: at), "versionCount": .number(Double(versionCount)),
            "totalBytes": .number(36),
        ])
    }
}

extension JSONValue {
    var outputVersion: OutputVersion { try! decoded(as: ArtifactVersion.self) }
    var outputItem: OutputItem { try! decoded(as: ArtifactSummary.self) }
    var outputProvenance: OutputProvenance { try! decoded(as: ArtifactProvenance.self) }
}

/// `task.*` records as a machine writes them, with the fields the schema requires.
enum TaskWire {
    static func task(
        _ id: String = "t1", project: String = "p", parent: String = "parent", child: String = "c", created: Double = 0,
        status: String = "open", settled: Double? = nil, paused: JSONValue? = nil
    ) -> AgentTask {
        var fields: [String: JSONValue] = [
            "id": .string(id), "projectId": .string(project), "parentId": .string(parent),
            "childId": .string(child), "title": .string("Task \(id)"), "prompt": .string("Do it."),
            "status": .string(status), "result": .null, "createdAt": .number(created),
            "settledAt": settled.map(JSONValue.number) ?? .null, "wake": .string("none"),
        ]
        if let paused { fields["paused"] = paused }
        return try! JSONValue.object(fields).decoded(as: AgentTask.self)
    }
}

extension JSONValue {
    /// A device as `device.list` writes it. A fixture that does not decode is a broken test, not a case to cover.
    var deviceInfo: DeviceInfo { try! decoded(as: DeviceInfo.self) }
    var deviceReference: StoredDeviceViewDevice { try! decoded(as: StoredDeviceViewDevice.self) }
}

/// `accounts.list` answers and `usage.*` readings as a machine writes them. A test names the fields it is about, and the
/// rest takes defaults, so the reading decodes into the generated types as a real one does.
enum AccountsWire {
    static func status(
        _ id: String, kind: String = "claude", state: String = "ready", email: String? = nil, plan: String? = nil,
        message: String? = nil, checkedAt: Double = 1
    ) -> JSONValue {
        .object([
            "id": .string(id), "kind": .string(kind), "state": .string(state),
            "email": email.map(JSONValue.string) ?? .null, "plan": plan.map(JSONValue.string) ?? .null,
            "organization": .null, "home": .string("/home"), "message": message.map(JSONValue.string) ?? .null,
            "checkedAt": .number(checkedAt),
        ])
    }

    static func snapshot(accounts: [String: JSONValue], statuses: [JSONValue] = []) -> JSONValue {
        .object(["accounts": .object(accounts), "statuses": .array(statuses)])
    }
}

extension JSONValue {
    var accountsSnapshot: AccountsSnapshot { try! decoded(as: AccountsSnapshot.self) }
    var accountStatus: AccountStatus { try! decoded(as: AccountStatus.self) }
    var usageLimits: UsageLimits { try! decoded(as: UsageLimits.self) }
    var usageSummary: UsageSummary { try! decoded(as: UsageSummary.self) }
}

/// Views and nodes of a project document as a machine writes them. A test names the fields it is about, and the rest
/// takes the defaults of the kind, so the view decodes into the generated types as a real one does.
enum ProjectWire {
    static func view(_ fields: JSONValue) -> JSONValue {
        let id = fields["id"]?.stringValue ?? "view"
        var defaults: [String: JSONValue] = ["name": .string(id)]
        switch fields["kind"]?.stringValue {
        case "canvas": defaults.merge(["nodes": .array([]), "texts": .array([]), "edges": .array([])]) { $1 }
        case "chat", "terminal", "artifact": defaults["node"] = .object([:])
        case "design": defaults.merge(["node": .object([:]), "path": .string("design.md")]) { $1 }
        case "browser": defaults["url"] = .string("https://ruimte.app")
        case "file": defaults["path"] = .string("README.md")
        case "device":
            defaults["device"] = .object([
                "platform": .string("ios"), "kind": .string("simulator"), "name": .string("iPhone"),
                "runtime": .string("iOS 27"),
            ])
        case "database":
            defaults.merge([
                "connectionId": .string("main"), "schema": .string("public"), "table": .string("users"),
                "mode": .string("data"),
            ]) { $1 }
        default: break
        }
        var view = defaults.merging(fields.objectValue ?? [:]) { _, given in given }
        if let nodes = view["nodes"]?.arrayValue { view["nodes"] = .array(nodes.map(node)) }
        return .object(view)
    }

    static func node(_ fields: JSONValue) -> JSONValue {
        let id = fields["id"]?.stringValue ?? "node"
        let defaults: [String: JSONValue] = [
            "title": .string(id), "x": .number(0), "y": .number(0), "w": .number(320), "h": .number(200),
        ]
        return .object(defaults.merging(fields.objectValue ?? [:]) { _, given in given })
    }

    /// The views a screen reads. A fixture that does not decode is a broken test, not a case to cover.
    static func stored(_ views: [JSONValue]) -> [StoredView] {
        views.map { try! view($0).decoded(as: StoredView.self) }
    }
}

extension NowRequest {
    /// A request written as a machine writes it in `ChatInfo.requests`. One that does not decode reads as no request,
    /// as the card does for a kind it does not know.
    init?(_ value: JSONValue) {
        guard let item = try? value.decoded(as: ChatInfoRequestsItem.self) else { return nil }
        self.init(item)
    }
}

/// `provider.list` answers as a machine writes them. A test names the fields it is about, and the rest takes defaults,
/// so the list decodes into the generated types as a real one does.
enum ProviderWire {
    static func model(
        _ slug: String, name: String? = nil, legacy: Bool = false, options: [JSONValue] = []
    ) -> JSONValue {
        .object([
            "slug": .string(slug), "name": .string(name ?? slug), "legacy": .bool(legacy), "isDefault": .bool(false),
            "options": .array(options),
        ])
    }

    static func choice(_ id: String, _ label: String) -> JSONValue {
        .object(["id": .string(id), "label": .string(label)])
    }

    static func effort(default defaultChoice: String = "medium", choices: [JSONValue]) -> JSONValue {
        .object([
            "id": .string("effort"), "label": .string("Effort"), "type": .string("select"),
            "choices": .array(choices), "defaultChoice": .string(defaultChoice),
        ])
    }

    static func capabilities(_ fields: [String: JSONValue] = [:]) -> JSONValue {
        let defaults: [String: JSONValue] = [
            "chat": .bool(true), "terminal": .bool(true), "hooks": .bool(true), "streamsToolOutput": .bool(true),
            "diffs": .string("unified"), "attachments": .bool(true), "mentions": .bool(true),
            "denyReason": .bool(false), "allowAlways": .bool(true), "asyncQuestions": .bool(false),
            "compaction": .string("native"), "reportsCost": .bool(true), "reportsContextWindow": .bool(true),
            "reportsThinking": .bool(true), "slashCommands": .bool(true),
        ]
        return .object(defaults.merging(fields) { _, given in given })
    }

    static func provider(
        _ kind: String, name: String? = nil, installed: Bool = true, version: String? = nil,
        models: [JSONValue] = [], defaultModel: String? = nil, capabilities fields: [String: JSONValue] = [:]
    ) -> JSONValue {
        .object([
            "kind": .string(kind), "name": .string(name ?? kind), "installed": .bool(installed),
            "version": version.map(JSONValue.string) ?? .null, "models": .array(models),
            "defaultModel": defaultModel.map(JSONValue.string) ?? .null, "capabilities": capabilities(fields),
            "resumeCommand": .string(kind),
        ])
    }

    static func list(_ providers: [JSONValue]) -> JSONValue { .object(["providers": .array(providers)]) }
}

extension JSONValue {
    var providerInfo: ProviderInfo { try! decoded(as: ProviderInfo.self) }
    var providerModel: ProviderModel { try! decoded(as: ProviderModel.self) }
}

/// Project rows as `project.list`, `project.sidebar` and `project.summary` write them. A test names the fields it is
/// about, and the rest takes defaults, so the row decodes into the generated types as a real one does.
enum ProjectRowWire {
    static func summary(
        _ id: String = "project", name: String? = nil, opened: Double = 0, closed: Double? = nil,
        available: Bool = true, scratch: Bool = false, color: String = "#c4573a", folder: String? = nil,
        icon: JSONValue? = nil
    ) -> JSONValue {
        var values: [String: JSONValue] = [
            "projectId": .string(id), "name": .string(name ?? id), "color": .string(color),
            "folder": .string(folder ?? "/work/\(id)"), "lastOpenedAt": .number(opened),
            "available": .bool(available),
            "icon": icon ?? .object(["kind": .string("initial"), "value": .string("")]),
            "nameSource": .string("chosen"),
        ]
        if let closed { values["closedAt"] = .number(closed) }
        if scratch { values["scratch"] = .bool(true) }
        return .object(values)
    }

    static func sidebarNode(_ id: String, kind: String, title: String) -> JSONValue {
        .object(["id": .string(id), "title": .string(title), "kind": .string(kind), "provider": .null])
    }

    static func sidebarView(_ id: String, kind: String, name: String = "", nodes: [JSONValue] = []) -> JSONValue {
        .object([
            "id": .string(id), "name": .string(name), "kind": .string(kind), "icon": .null, "provider": .null,
            "path": .null, "shared": .bool(false), "nodes": .array(nodes), "self": .null,
        ])
    }

    /// A sidebar entry; without views the machine could not read the project's file.
    static func sidebarEntry(_ summary: JSONValue, views: [JSONValue]?) -> JSONValue {
        .object(["summary": summary, "views": views.map(JSONValue.array) ?? .null])
    }
}

extension JSONValue {
    var projectSummary: ProjectSummary { try! decoded(as: ProjectSummary.self) }
    var sidebarEntry: ProjectSidebarEntry { try! decoded(as: ProjectSidebarEntry.self) }
}

extension ProjectWire {
    /// A view as the lists read it. A fixture that does not decode is a broken test, not a case to cover.
    static func item(_ fields: JSONValue) -> ProjectItem { ProjectItem(try! view(fields).decoded(as: StoredView.self)) }

    static func nodeItem(_ fields: JSONValue) -> ProjectItem {
        ProjectItem(try! node(fields).decoded(as: StoredNode.self))
    }
}
