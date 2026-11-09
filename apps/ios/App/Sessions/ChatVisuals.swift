import Foundation
import RuimtePulsar
import RuimteTransport

/// A page an agent published in the chat, as `chat.visuals` and the attach describe it. Its id is also the id of the
/// stored page among the chat's attachments.
struct ChatVisual: Equatable, Identifiable {
    struct Measure: Equatable {
        let width: Double
        let height: Double
    }

    let id: String
    let title: String
    /// Milliseconds on the machine's clock, the one of an item's `createdAt`, which is what places it in the thread.
    let at: Double
    let maxHeight: Double
    /// Measured at publish in CSS pixels, ascending by width; empty while nobody measured the page.
    let heights: [Measure]
    let size: Double
    let turnID: String?
    /// Asked for by an agent for a mockup or a dashboard: the whole width of the thread rather than the reply column's.
    let wide: Bool

    init(
        id: String, title: String, at: Double, maxHeight: Double = ChatVisualContract.maxHeight,
        heights: [Measure] = [], size: Double = 0, turnID: String? = nil, wide: Bool = false
    ) {
        self.id = id
        self.title = title
        self.at = at
        self.maxHeight = maxHeight
        self.heights = heights
        self.size = size
        self.turnID = turnID
        self.wide = wide
    }

    init?(_ value: JSONValue) {
        guard let id = value["id"]?.stringValue, !id.isEmpty, let at = value["at"]?.numberValue else { return nil }
        self.init(
            id: id, title: value.text("title"), at: at,
            maxHeight: value["maxHeight"]?.numberValue ?? ChatVisualContract.maxHeight,
            heights: value.list("heights").compactMap { pair in
                guard let pair = pair.arrayValue, pair.count == 2, let width = pair[0].numberValue,
                    let height = pair[1].numberValue
                else { return nil }
                return Measure(width: width, height: height)
            },
            size: value.number("size"), turnID: value["turnId"]?.stringValue,
            wide: value["layout"]?.stringValue == "wide")
    }
}

/// What a visual's card asked for, carried out by the chat screen, since a card that scrolls away goes with its row.
struct ChatVisualRequest: Identifiable, Equatable {
    enum Action: Equatable { case expand, remove }
    let visualID: String
    let action: Action
    var id: String { "\(visualID).\(action)" }
}

enum ChatVisuals {
    static func parse(_ values: [JSONValue]) -> [ChatVisual] { values.compactMap(ChatVisual.init) }

    /// When what a row shows began, as the desktop's timeline reads it; nil for a row that only follows the one
    /// before it (a turn's changed files and forks, a selection switch, a note, a report, a message the agent sent).
    /// The working row closes its turn.
    @MainActor static func rowTime(_ entry: ChatTimelineEntry) -> Double? {
        switch entry.kind {
        case .activity: return .infinity
        case .turnFold, .turnStart, .subagent, .tools: return entry.items.first?.item.createdAt
        case .changedFiles, .forks, .visual, .output, .selectionSwitch: return nil
        // It stands for the call it is repeated over, which it carries after the thought.
        case .liveThought: return entry.items.last?.item.createdAt
        case .message:
            guard let item = entry.items.first?.item else { return nil }
            switch item {
            case .user, .assistant, .thinking, .approval, .question: return item.createdAt
            case .tool(let tool):
                return ChatSubagents.handbackReport(item) == nil && RuimteCommandLook.sent(of: tool) == nil
                    ? item.createdAt : nil
            case .subagent, .turn, .note, .compaction: return nil
            }
        }
    }

    /// The thread's rows with the visuals and Output cards among them, each right before the first row that began
    /// after it: in a folded turn under the fold and above the answer, in a running one between its calls, and always
    /// above the working row. A visual comes first among those of the same moment. While an earlier page of the thread
    /// is not read yet, a visual from before `heldFrom` waits for it.
    @MainActor static func placed(
        _ rows: [ChatTimelineEntry], visuals: [ChatVisual], cards: [ChatOutputCard] = [], heldFrom: Double?
    ) -> [ChatTimelineEntry] {
        let timed =
            visuals.filter { visual in heldFrom.map { visual.at >= $0 } ?? true }.map { (at: $0.at, row: entry($0)) }
            + cards.map { (at: $0.at, row: ChatTimelineEntry(id: "app-card-\($0.id)", kind: .output, output: $0)) }
        let pending = timed.enumerated()
            .sorted { $0.element.at == $1.element.at ? $0.offset < $1.offset : $0.element.at < $1.element.at }
            .map(\.element)
        guard !pending.isEmpty else { return rows }
        var merged: [ChatTimelineEntry] = []
        var next = 0
        for row in rows {
            if let time = rowTime(row) {
                while next < pending.count, pending[next].at < time {
                    merged.append(pending[next].row)
                    next += 1
                }
            }
            merged.append(row)
        }
        merged += pending[next...].map(\.row)
        return merged
    }

    @MainActor private static func entry(_ visual: ChatVisual) -> ChatTimelineEntry {
        ChatTimelineEntry(id: "visual-\(visual.id)", kind: .visual, visual: visual)
    }
}

/// How tall a visual's card stands, in points, which a page drawn at the device's width counts as CSS pixels.
enum ChatVisualHeights {
    /// Room for a chart before anything measured the page.
    static let fallback: Double = 240
    /// Plenty for the visuals of a long session; the oldest goes first.
    private static let limit = 500
    /// The heights cards reported, by visual and width, so a row that scrolls back in starts where it was.
    @MainActor private static var remembered: [String: [Int: Double]] = [:]
    @MainActor private static var order: [(id: String, width: Int)] = []

    /// A height a page reported, held to the visual's own maximum and the limits, in whole points.
    static func clamp(_ height: Double, maxHeight: Double) -> Double {
        min(max(min(height, maxHeight).rounded(.up), ChatVisualContract.minHeight), ChatVisualContract.maxHeight)
    }

    /// `visualFrameHeight` of the contracts: the taller of the measurements on either side of the width, since a
    /// breakpoint between them can make the page as tall as either.
    static func measured(_ visual: ChatVisual, width: Double) -> Double? {
        let below = visual.heights.filter { $0.width <= width }.max { $0.width < $1.width }
        let above = visual.heights.filter { $0.width >= width }.min { $0.width < $1.width }
        guard below != nil || above != nil else { return nil }
        return clamp(max(below?.height ?? 0, above?.height ?? 0), maxHeight: visual.maxHeight)
    }

    /// What this device saw at that width before, else what the machine measured, else a modest default.
    static func initial(_ visual: ChatVisual, width: Double, remembered: [Int: Double]) -> Double {
        remembered[Int(width.rounded())] ?? measured(visual, width: width)
            ?? clamp(fallback, maxHeight: visual.maxHeight)
    }

    /// The heights remembered for a visual, by width in whole points.
    @MainActor static func remembered(_ visualID: String) -> [Int: Double] { remembered[visualID] ?? [:] }

    @MainActor static func remember(_ visualID: String, width: Double, height: Double) {
        let width = Int(width.rounded())
        order.removeAll { $0.id == visualID && $0.width == width }
        order.append((visualID, width))
        remembered[visualID, default: [:]][width] = height
        if order.count > limit {
            let oldest = order.removeFirst()
            remembered[oldest.id]?[oldest.width] = nil
        }
    }
}

/// The pages of a chat's visuals, read once and kept within a budget, so a card that scrolls back in or opens large
/// does not read its page again.
@MainActor final class ChatVisualPages {
    private static let budget = 48 * 1024 * 1024
    private var pages: [String: Data] = [:]
    private var order: [String] = []
    private var reading: [String: Task<Data, Error>] = [:]

    func page(_ id: String, read: @escaping @MainActor () async throws -> Data) async throws -> Data {
        if let page = pages[id] { return page }
        let task = reading[id] ?? Task { try await read() }
        reading[id] = task
        do {
            let page = try await task.value
            reading[id] = nil
            keep(page, id: id)
            return page
        } catch {
            reading[id] = nil
            throw error
        }
    }

    /// A visual's page, read the way any attachment of the chat is.
    func page(_ id: String, client: any MachineRequesting, chatID: String) async throws -> Data {
        try await page(id) {
            try await client.readResource(
                .chatAttachment(chatID: chatID, id: id), maxBytes: ChatVisualContract.maxBytes
            )
            .data
        }
    }

    private func keep(_ page: Data, id: String) {
        guard pages[id] == nil else { return }
        pages[id] = page
        order.append(id)
        var total = pages.values.reduce(0) { $0 + $1.count }
        while total > Self.budget, order.count > 1 {
            let oldest = order.removeFirst()
            total -= pages.removeValue(forKey: oldest)?.count ?? 0
        }
    }
}

extension ChatModel {
    func visualPage(_ id: String) async throws -> Data {
        try await presentation.visualPages.page(id, client: client, chatID: chatID)
    }

    /// Deletes a visual's page on the machine, for every client of the chat.
    func removeVisual(_ id: String) async {
        do {
            let result = try await client.request(
                .chatRemoveVisual, payload: target(["visualId": .string(id)]))
            presentation.setVisuals(ChatVisuals.parse(result.list("visuals")))
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
