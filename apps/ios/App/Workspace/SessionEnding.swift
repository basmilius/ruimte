import Foundation
import RuimtePulsar
import RuimteTransport

/// Taking a chat or a terminal out of a project ends it on the machine, as the desktop does once a person deletes its
/// node or view: a chat with `chat.kill`, so its CLI stops and its thread, attachments and bookmarks go, and a terminal
/// with `session.kill`, so its shell and whatever runs in it end. The agents they opened go with them. A turn only stops
/// with `chat.cancel`, and the chat stays.
enum SessionEnding {
    /// The nodes that go with a view or a node: the item itself, or the nodes of that kind on a canvas.
    static func sessions(in item: JSONValue, kind: String) -> [String] {
        if item.text("kind") == kind { return [item.stableID] }
        return item.list("nodes").filter { $0.text("kind") == kind }.map(\.stableID)
    }

    static func chats(in item: JSONValue) -> [String] { sessions(in: item, kind: "chat") }
    static func terminals(in item: JSONValue) -> [String] { sessions(in: item, kind: "terminal") }

    /// What a delete says about the sessions going with it, ahead of what it says about the rest; nil without any.
    static func warning(chats: Int, terminals: Int = 0, agents: Int) -> String? {
        var parts: [String] = []
        if chats > 0 {
            parts.append(
                chats == 1
                    ? "The chat ends on this machine, and its conversation is gone."
                    : "Its \(chats) chats end on this machine, and their conversations are gone.")
        }
        if terminals > 0 {
            parts.append(
                terminals == 1
                    ? "The terminal ends on this machine, with everything running in it."
                    : "Its \(terminals) terminals end on this machine, with everything running in them.")
        }
        guard !parts.isEmpty else { return nil }
        if agents > 0 { parts.append(ChatSubagents.endsAgentsWarning(agents)) }
        return parts.joined(separator: " ")
    }

    struct Question: Equatable {
        var chats: [String] = []
        var terminals: [String] = []
        var warning: String?
    }

    /// The question before a delete that takes sessions along, with the agents they opened counted.
    @MainActor static func question(for item: JSONValue, client: any MachineRequesting) async -> Question {
        let chats = chats(in: item)
        let terminals = terminals(in: item)
        guard !chats.isEmpty || !terminals.isEmpty else { return Question() }
        let agents = await ChatSubagents.agentsEnded(with: chats + terminals, client: client)
        return Question(
            chats: chats, terminals: terminals,
            warning: warning(chats: chats.count, terminals: terminals.count, agents: agents))
    }

    /// Ends the terminals once they left the project. A shell that already ended has nothing to end, so a refusal
    /// changes nothing.
    @MainActor static func endTerminals(_ terminals: [String], client: any MachineRequesting) async {
        for id in terminals {
            _ = try? await client.request(WireRequest.sessionKill.rawValue, payload: .object(["sessionId": .string(id)]))
        }
    }

    /// Ends the sessions once they left the project. A chat this machine never loaded has nothing to end either.
    @MainActor static func end(_ question: Question, session: SharedMachineSession) async {
        for id in question.chats {
            session.forgetChat(id)
            _ = try? await session.rpc.request(WireRequest.chatKill.rawValue, payload: .object(["chatId": .string(id)]))
        }
        await endTerminals(question.terminals, client: session.rpc)
    }
}
