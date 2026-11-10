import Foundation
import RuimtePulsar
import RuimteShared
import RuimteTransport
import SwiftUI

/// A message a person marked to come back to, as `chat.bookmarks` describes it. It hangs on the item's id and every
/// client of the chat sees the same.
struct ChatBookmark: Equatable, Identifiable {
    let itemID: String
    /// Nil while nobody named it; a list shows the excerpt instead.
    let name: String?
    let excerpt: String
    let createdAt: Double
    var id: String { itemID }
    var label: String { name ?? excerpt }

    init(itemID: String, name: String? = nil, excerpt: String, createdAt: Double = 0) {
        self.itemID = itemID
        self.name = name
        self.excerpt = excerpt
        self.createdAt = createdAt
    }

    init?(_ value: JSONValue) {
        guard let itemID = value["itemId"]?.stringValue, !itemID.isEmpty else { return nil }
        self.init(
            itemID: itemID, name: value["name"]?.stringValue, excerpt: value["excerpt"]?.stringValue ?? "",
            createdAt: value["createdAt"]?.numberValue ?? 0)
    }
}

/// What to do with a message's bookmark, asked by a row's menu and carried out by the chat screen.
struct ChatBookmarkRequest: Identifiable, Equatable {
    enum Action: Equatable { case add, rename, remove }
    let itemID: String
    let action: Action
    var id: String { "\(itemID).\(action)" }
}

enum ChatBookmarks {
    /// `CHAT_BOOKMARK_LIMITS.name` in the contracts.
    static let nameMax = 120

    static func parse(_ values: [JSONValue]) -> [ChatBookmark] { values.compactMap(ChatBookmark.init) }

    /// The bookmarks in the order of the thread; one whose message this client does not hold goes last.
    static func inThreadOrder(_ bookmarks: [ChatBookmark], order: [String]) -> [ChatBookmark] {
        let places = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
        return bookmarks.sorted {
            let left = places[$0.itemID] ?? order.count
            let right = places[$1.itemID] ?? order.count
            return left == right ? $0.createdAt < $1.createdAt : left < right
        }
    }

    /// What a person asked of a chat that a bookmark can mark: a message they sent or an answer, in the chat's own
    /// thread rather than a sub-agent's.
    static func markable(_ item: ChatItem) -> Bool {
        switch item {
        case .user: true
        case .assistant(let reply): item.parentToolUseID == nil && !reply.streaming
        default: false
        }
    }

    /// The request a name field settles on, or nil when the name did not change. A name goes through `addBookmark`,
    /// which also names a bookmark that already stands; an empty one takes the name away.
    static func naming(_ name: String, previous: String?) -> (request: WireRequest, name: String)? {
        let next = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(nameMax))
        guard next != (previous ?? "") else { return nil }
        return next.isEmpty ? (.chatRenameBookmark, "") : (.chatAddBookmark, next)
    }
}

extension ChatModel {
    /// Marks a message; true once the machine holds the bookmark.
    func addBookmark(_ itemID: String) async -> Bool {
        await changeBookmarks(.chatAddBookmark, ["itemId": .string(itemID)])
    }

    func nameBookmark(_ itemID: String, name: String) async {
        guard let change = ChatBookmarks.naming(name, previous: presentation.bookmarks[itemID]?.name) else { return }
        _ = await changeBookmarks(change.request, ["itemId": .string(itemID), "name": .string(change.name)])
    }

    func removeBookmark(_ itemID: String) async {
        _ = await changeBookmarks(.chatRemoveBookmark, ["itemId": .string(itemID)])
    }

    /// Scrolls to a bookmarked message, reading earlier pages of the thread until it is there.
    func revealBookmark(_ itemID: String) async {
        _ = await readOlder { presentation.revealItem(itemID) }
    }

    /// Leads a quote back to the reply it quotes and lights it up, reading earlier pages of the thread until it is
    /// there. One the thread no longer holds says so on its message.
    func revealQuote(_ jump: ChatQuoteJump) async {
        if await readOlder(until: { presentation.revealItem(jump.sourceID, flashing: true) }) {
            presentation.finishQuote(jump, gone: false)
        } else if !Task.isCancelled {
            // Only a thread read to its start knows the reply is gone; one that could not read further does not.
            presentation.finishQuote(jump, gone: history.cursor == nil)
        }
    }

    func revealUiChoice(_ target: UiChoiceJump) async {
        guard await readOlder(until: { presentation.item(target.itemID) != nil }),
            !Task.isCancelled, let reply = presentation.item(target.itemID)?.assistantItem,
            (reply.ui ?? []).contains(where: { $0.id == target.blockID && $0.revision == target.revision })
        else { return }
        presentation.uiChoiceHighlight = target
        _ = presentation.revealItem(target.itemID)
    }

    /// Reads earlier pages of the thread until `found` holds; false once no page came or the task was cancelled.
    private func readOlder(until found: () -> Bool) async -> Bool {
        while !found() {
            guard !Task.isCancelled else { return false }
            if loadingHistory {
                guard await waitUntil({ !self.loadingHistory }) else { return false }
            } else if await !loadOlderNow() {
                return false
            }
        }
        return true
    }

    private func changeBookmarks(_ request: WireRequest, _ values: [String: JSONValue]) async -> Bool {
        do {
            let result = try await client.request(request, payload: target(values))
            presentation.setBookmarks(ChatBookmarks.parse(result.list("bookmarks")))
            error = nil
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

/// A bookmark as a line over the message it marks, its name or the start of the message beside it.
struct ChatBookmarkMarker: View {
    let bookmark: ChatBookmark

    var body: some View {
        HStack(spacing: 8) {
            Image(lucide: "bookmark", size: 14).foregroundStyle(MobileStyle.accent)
            Text(bookmark.label).font(.caption).lineLimit(1).truncationMode(.tail)
                .foregroundStyle(bookmark.name == nil ? MobileStyle.muted : MobileStyle.text)
            MobileStyle.border.frame(height: 1).frame(minWidth: 24)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Bookmark, \(bookmark.label)")
    }
}

struct ChatBookmarkButtons: View {
    let presentation: ChatPresentation
    let itemID: String

    var body: some View {
        if presentation.bookmarks[itemID] == nil {
            Button(String(localized: "Bookmark message"), lucideIcon: "bookmark-plus") {
                presentation.bookmarkRequest = ChatBookmarkRequest(itemID: itemID, action: .add)
            }
        } else {
            Button(String(localized: "Rename bookmark"), lucideIcon: "pencil") {
                presentation.bookmarkRequest = ChatBookmarkRequest(itemID: itemID, action: .rename)
            }
            Button(String(localized: "Remove bookmark"), lucideIcon: "bookmark-x") {
                presentation.bookmarkRequest = ChatBookmarkRequest(itemID: itemID, action: .remove)
            }
        }
    }
}

/// The chat's bookmarks in the order of the thread: a popover on iPad and a sheet on iPhone, like Messages. A tap jumps
/// to the message; a long press or a swipe renames or removes.
struct ChatBookmarkList: View {
    let presentation: ChatPresentation
    let jump: (String) -> Void
    let rename: (String) -> Void
    let remove: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(presentation.orderedBookmarks) { bookmark in
                    row(bookmark)
                }
            }
            .listStyle(.plain)
            .overlay {
                if presentation.bookmarks.isEmpty {
                    ContentUnavailableView(
                        String(localized: "No bookmarks"), lucideIcon: "bookmark",
                        description: Text("Long-press a message to bookmark it."))
                }
            }
            .navigationTitle("Bookmarks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(role: .close) { dismiss() } }
            }
        }
        .frame(idealWidth: 400, idealHeight: 560)
    }

    private func row(_ bookmark: ChatBookmark) -> some View {
        Button {
            jump(bookmark.itemID)
            dismiss()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(lucide: "bookmark", size: 14).foregroundStyle(MobileStyle.accent).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(bookmark.label).lineLimit(3)
                        .foregroundStyle(bookmark.name == nil ? MobileStyle.muted : MobileStyle.text)
                    if bookmark.createdAt > 0 {
                        Text(Format.dayClock(Date(timeIntervalSince1970: bookmark.createdAt / 1000)))
                            .font(.caption).foregroundStyle(MobileStyle.muted).monospacedDigit()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Jumps to this message")
        .contextMenu {
            Button(String(localized: "Rename bookmark"), lucideIcon: "pencil") { rename(bookmark.itemID) }
            Button(String(localized: "Remove bookmark"), lucideIcon: "bookmark-x", role: .destructive) {
                remove(bookmark.itemID)
            }
        }
        .swipeActions(edge: .trailing) {
            Button(String(localized: "Remove"), lucideIcon: "bookmark-x", role: .destructive) {
                remove(bookmark.itemID)
            }
            .tint(MobileStyle.swipeDestructive)
            Button(String(localized: "Rename"), lucideIcon: "pencil") { rename(bookmark.itemID) }.tint(
                MobileStyle.swipeAction)
        }
    }
}
