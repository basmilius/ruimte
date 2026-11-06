import Foundation
import RuimtePulsar

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
