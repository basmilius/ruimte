import Foundation
import RuimtePulsar
import RuimteTransport

/// The snooze choices of the desktop sidebar's context menu.
enum ChatSnoozeChoice: CaseIterable {
    case tenMinutes, hour, tomorrow

    var label: String {
        switch self {
        case .tenMinutes: String(localized: "10 minutes", comment: "Snooze for this long")
        case .hour: String(localized: "1 hour", comment: "Snooze for this long")
        case .tomorrow: String(localized: "Tomorrow", comment: "Snooze until tomorrow morning")
        }
    }
}

enum ChatSnooze {
    /// The hour Tomorrow wakes at, local time.
    static let morningHour = 9

    /// When a choice made at `now` runs out. Tomorrow is the next 09:00 still ahead, as `snoozeUntil` on the desktop
    /// has it, so a snooze set at two in the night wakes the same morning.
    static func until(_ choice: ChatSnoozeChoice, now: Date, calendar: Calendar = .current) -> Date {
        switch choice {
        case .tenMinutes: return now.addingTimeInterval(10 * 60)
        case .hour: return now.addingTimeInterval(60 * 60)
        case .tomorrow:
            let morning = calendar.date(bySettingHour: morningHour, minute: 0, second: 0, of: now) ?? now
            return morning > now ? morning : calendar.date(byAdding: .day, value: 1, to: morning) ?? morning
        }
    }

    /// The moment a node's snooze runs out, from a `snooze.list` answer or a `snooze.changed` event, in epoch
    /// milliseconds; nil when the node has none.
    static func until(of nodeID: String, in payload: JSONValue) -> Double? {
        payload.list("snoozes").first { $0.text("nodeId") == nodeID }?["until"]?.numberValue
    }

    /// The `snooze.set` payload: the machine wants the moment itself, worked out where the person is.
    static func payload(nodeID: String, until: Date) -> JSONValue {
        .object(["nodeId": .string(nodeID), "until": .number((until.timeIntervalSince1970 * 1000).rounded())])
    }
}

enum ChatRename {
    /// The project's views with the chat renamed, as a person names it: a chat view by its name, a chat node by its
    /// title. Nil when the project holds no chat by that id or the name is empty.
    static func renamed(_ views: [JSONValue], chatID: String, to name: String) -> [JSONValue]? {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        var found = false
        let next = views.map { view -> JSONValue in
            if view.text("kind") == "chat" && view.stableID == chatID {
                found = true
                return view.setting("name", .string(name)).setting("titleSource", .string("user"))
            }
            let nodes = view.list("nodes")
            guard nodes.contains(where: { $0.stableID == chatID && $0.text("kind") == "chat" }) else { return view }
            found = true
            return view.setting(
                "nodes",
                .array(
                    nodes.map {
                        $0.stableID == chatID
                            ? $0.setting("title", .string(name)).setting("titleSource", .string("user")) : $0
                    }))
        }
        return found ? next : nil
    }
}

extension ChatModel {
    /// Whether the chat is snoozed at `now`.
    func isSnoozed(now: Date = .now) -> Bool {
        snoozedUntil.map { $0 > now.timeIntervalSince1970 * 1000 } ?? false
    }

    func readSnoozes() async {
        do {
            let result = try await client.request(WireRequest.snoozeList.rawValue, payload: .object([:]))
            snoozeAvailable = true
            snoozedUntil = ChatSnooze.until(of: chatID, in: result)
        } catch {
            snoozeAvailable = !ChatForking.isUnknownRequest(error)
        }
    }

    func snooze(_ choice: ChatSnoozeChoice, now: Date = .now) async {
        let until = ChatSnooze.until(choice, now: now)
        do {
            _ = try await client.request(
                WireRequest.snoozeSet.rawValue, payload: ChatSnooze.payload(nodeID: chatID, until: until))
            snoozedUntil = until.timeIntervalSince1970 * 1000
            error = nil
        } catch {
            self.error = ChatForking.message(
                for: error, update: String(localized: "Update Ruimte on this machine to snooze a chat."))
        }
    }

    func unsnooze() async {
        do {
            _ = try await client.request(
                WireRequest.snoozeClear.rawValue, payload: .object(["nodeId": .string(chatID)]))
            snoozedUntil = nil
            error = nil
        } catch {
            self.error = ChatForking.message(
                for: error, update: String(localized: "Update Ruimte on this machine to end a snooze."))
        }
    }

    /// Puts text in the draft for the person to send, after what they already wrote, as the desktop's plan panel
    /// offers a plan's results.
    func offerDraft(_ text: String) {
        let current = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = current.isEmpty ? text : draft + "\n\n" + text
        composition.selection = NSRange(location: (draft as NSString).length, length: 0)
    }
}
