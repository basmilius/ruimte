import Foundation
import RuimtePulsar
import RuimteTransport

/// Taking a chat out of a project ends it on the machine with `chat.kill`, as the desktop does once a person deletes
/// its node or view: its CLI stops and its thread, attachments and bookmarks go, and so do the agents it opened. A turn
/// only stops with `chat.cancel`, and the chat stays.
enum ChatEnding {
    /// The chats that go with a view or a node: a chat itself, or the chat nodes on a canvas.
    static func chats(in item: JSONValue) -> [String] {
        if item.text("kind") == "chat" { return [item.stableID] }
        return item.list("nodes").filter { $0.text("kind") == "chat" }.map(\.stableID)
    }

    /// What a delete says about the chats going with it, ahead of what it says about the rest; nil without chats.
    static func warning(chats: Int, agents: Int) -> String? {
        guard chats > 0 else { return nil }
        let ends =
            chats == 1
            ? "The chat ends on this machine, and its conversation is gone."
            : "Its \(chats) chats end on this machine, and their conversations are gone."
        return agents == 0 ? ends : "\(ends) \(ChatSubagents.endsAgentsWarning(agents))"
    }

    /// The question before a delete that takes chats along, with the agents they opened counted.
    @MainActor static func question(for item: JSONValue, client: any MachineRequesting) async -> (
        chats: [String], warning: String?
    ) {
        let chats = chats(in: item)
        guard !chats.isEmpty else { return ([], nil) }
        let agents = await ChatSubagents.agentsEnded(with: chats, client: client)
        return (chats, warning(chats: chats.count, agents: agents))
    }

    /// Ends the chats once they left the project. A chat this machine never loaded has nothing to end, so a refusal
    /// changes nothing.
    @MainActor static func end(_ chats: [String], session: SharedMachineSession) async {
        for id in chats {
            session.forgetChat(id)
            _ = try? await session.rpc.request(WireRequest.chatKill.rawValue, payload: .object(["chatId": .string(id)]))
        }
    }
}
