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
        // A fixture that does not decode is a broken test, not a case to cover.
        return try! JSONValue.object(defaults.merging(fields) { _, given in given }).decoded(as: GitStatus.self)
    }

    /// One repository of a folder as `git.repos` lists it.
    static func repo(path: String, label: String, name: String? = nil, kind: GitRepoKind = .nested) -> JSONValue {
        var fields: [String: JSONValue] = [
            "path": .string(path), "label": .string(label), "kind": .string(kind.rawValue),
        ]
        if let name { fields["name"] = .string(name) }
        return .object(fields)
    }

    /// What `git.repos` answers.
    static func repos(_ repos: [JSONValue], truncated: Bool = false) -> JSONValue {
        .object(["repos": .array(repos), "truncated": .bool(truncated)])
    }

    /// The status as the machine writes it, for a fake machine to answer with.
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

    /// A fixture that does not decode is a broken test, not a case to cover.
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

    /// What `processes.subscribe` answers.
    static func subscribed(supported: Bool = true, sample: JSONValue = .null) -> JSONValue {
        .object([
            "supported": .bool(supported), "fineIntervalMs": .number(2000), "coarseIntervalMs": .number(300_000),
            "fine": .array([]), "coarse": .array([]), "sample": sample,
        ])
    }
}

extension JSONValue {
    // A fixture that does not decode is a broken test, not a case to cover.
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
            "startedAt": .number(1000), "endedAt": endedAt.map(JSONValue.number) ?? (state == "exited" ? .number(6000) : .null),
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
    // A fixture that does not decode is a broken test, not a case to cover.
    var launchEntry: LaunchEntry { try! LaunchEntry(raw: self) }
    var launchStatus: LaunchStatus { try! decoded(as: LaunchStatus.self) }
    var launchBook: LaunchBook { try! decoded(as: LaunchBook.self) }
    var launchSuggestion: LaunchSuggestion { try! decoded(as: LaunchSuggestion.self) }
}
