import Foundation
import Observation
import RuimteIntelligentUI
import RuimtePulsar
import RuimteShared
import RuimteTransport

@MainActor @Observable
final class ChatItemState: Identifiable {
    let id: String
    private(set) var item: ChatItem
    @ObservationIgnored private var trees: (key: TreeKey, trees: UiReplyTrees)?

    // The tree never reads prose; keeping the whole reply would pin text from an earlier update.
    private struct TreeKey: Equatable {
        let ui: [ChatUiBlock]?
        let queries: ChatUiQueryState?
        let answers: [String: ChatUiAnswer]?

        init(_ reply: ChatAssistantItem) {
            ui = reply.ui
            queries = reply.uiQueries
            answers = reply.uiAnswers
        }
    }

    init(_ item: ChatItem) {
        id = item.id
        self.item = item
    }

    func update(_ item: ChatItem) {
        self.item = item
        if item.assistantItem?.ui?.isEmpty != false { trees = nil }
    }

    /// A reply's blocks as the interpreter takes them, encoded again only when they change and not on every word the
    /// reply streams.
    var replyTrees: UiReplyTrees? {
        guard case .assistant(let reply) = item, reply.ui?.isEmpty == false else { return nil }
        let key = TreeKey(reply)
        if let trees, trees.key == key { return trees.trees }
        let next = UiReplyTrees(reply)
        trees = (key, next)
        return next
    }
}

/// Where a task's row reads what the thread does not carry: the task's own record, the chat of the agent working on
/// it, and the models of a CLI by its kind.
struct ChatAgentSources {
    var tasks: TaskStore?
    var attention: AttentionStore?
    var models: (String) -> [ProviderModel] = { _ in [] }
}

struct ChatTimelineEntry: Identifiable, Equatable {
    enum Kind: Equatable {
        case message, tools, activity, turnFold, turnStart, selectionSwitch, changedFiles, subagent, forks, visual,
            liveThought, output
    }
    let id: String
    let kind: Kind
    var items: [ChatItemState] = []
    var visual: ChatVisual?
    var branch: ChatSubagentBranch?
    var output: ChatOutputCard?
    /// What the turn before a `selectionSwitch` ran on; the turn in `items` carries what it switched to.
    var switchedFrom: ChatTurnItemSelection?
    /// Whether a `turnFold` hides anything a person may see; one that does not is a label that opens nothing.
    var expandable = true

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.kind == rhs.kind
            && lhs.items.map(ObjectIdentifier.init) == rhs.items.map(ObjectIdentifier.init) && lhs.visual == rhs.visual
            && lhs.branch == rhs.branch && lhs.output == rhs.output && lhs.switchedFrom == rhs.switchedFrom
            && lhs.expandable == rhs.expandable
    }
}

/// A sub-agent's row: the work the thread kept of it, and the agents it opened in turn, each a row of its own under
/// it, as `SubagentBranch` in `chat/logic/timeline.ts` of `@adecore/agents-react`.
struct ChatSubagentBranch: Equatable {
    // Deeper than the CLI forwards any call; it also ends a chain of rows that would name each other.
    static let maxNesting = 8

    let record: ChatItemState
    let children: [ChatItemState]
    let nested: [ChatSubagentBranch]

    @MainActor var item: ChatSubagentItem? { record.item.subagentItem }

    @MainActor init(_ record: ChatItemState, children: [String: [ChatItemState]], depth: Int = 0) {
        self.record = record
        let own = record.item.subagentItem.flatMap { children[$0.toolUseId] } ?? []
        self.children = own.filter { $0.item.subagentItem == nil }
        nested =
            depth >= Self.maxNesting
            ? [] : own.filter { $0.item.subagentItem != nil }.map { Self($0, children: children, depth: depth + 1) }
    }

    /// Every record of the branch, its own first.
    var records: [ChatItemState] { [record] + children + nested.flatMap(\.records) }

    @MainActor func contains(toolUseID: String) -> Bool {
        item?.toolUseId == toolUseID || nested.contains { $0.contains(toolUseID: toolUseID) }
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.record === rhs.record && lhs.children.map(ObjectIdentifier.init) == rhs.children.map(ObjectIdentifier.init)
            && lhs.nested == rhs.nested
    }
}

/// A row a jump landed on. A new one for every jump, so landing on the same row again lights it again.
struct ChatRowFlash: Equatable {
    /// A little longer than the light lasts, so a row that scrolls into view again later is not lit a second time.
    static let lifetime: TimeInterval = 2

    let entryID: String
    let nonce = UUID()
    let at = Date.now

    var fresh: Bool { Date.now.timeIntervalSince(at) < Self.lifetime }
}

/// A tap on the quote in a message, which leads back to the reply it quotes.
struct ChatQuoteJump: Equatable {
    let messageID: String
    let sourceID: String
    /// New for every tap, so tapping the same quote again looks again.
    let nonce = UUID()
}

/// A message that opens with the blockquote it was sent with, apart from what the person wrote under it.
enum ChatQuote {
    static func split(_ text: String) -> (quote: String, rest: String)? {
        let lines = text.components(separatedBy: "\n")
        let end = lines.firstIndex { $0 != ">" && !$0.hasPrefix("> ") } ?? lines.count
        guard end > 0, end == lines.count || lines[end].isEmpty else { return nil }
        let quote = lines[..<end].map { String($0.dropFirst(2)) }.joined(separator: "\n")
        return (quote, lines.dropFirst(end + 1).joined(separator: "\n"))
    }
}

extension ChatTimelineEntry {
    /// A line of work (a call, an agent, a question it asked) sits tight against the lines around it, as the desktop's
    /// list rhythm has them; prose, thoughts and cards keep a block's gap (`BLOCK_KINDS` in `chat/logic/timeline.ts`),
    /// so a run of work lines stands apart where it meets them.
    @MainActor var isWorkLine: Bool {
        switch kind {
        case .tools, .turnFold, .turnStart, .subagent, .liveThought, .activity, .forks: return true
        case .selectionSwitch, .changedFiles, .visual, .output: return false
        case .message:
            switch items.first?.item {
            case .approval?, .question?, .note?: return true
            case .tool(let tool)?:
                return ChatSubagents.handbackReport(.tool(tool)) == nil && !UiGeneratedImage.isGeneration(tool)
                    && RuimteCommandLook.sent(of: tool) == nil
            default: return false
            }
        }
    }

    /// Said to the chat as a person's message is: a message another node sent, and what Ruimte said in front of a
    /// prompt, as `saidToChat` on the desktop reads them.
    @MainActor var isSaidToChat: Bool {
        guard kind == .message else { return false }
        switch items.first?.item {
        case .user?: return true
        case .note(let note)?: return note.message != nil || note.said == true
        default: return false
        }
    }
}

extension ChatTimelineEntry {
    @MainActor var rhythm: ChatRowRhythm {
        if isSaidToChat { return .question }
        if kind == .message, case .tool(let tool)? = items.first?.item, RuimteCommandLook.sent(of: tool) != nil {
            return .sent
        }
        return isWorkLine ? .work : .block
    }
}

enum ChatRowRhythm: Equatable {
    case work, block, question, sent
}

/// The space above and below a row. Work lines sit tight against each other; where a run of them meets prose, either
/// way, the seam gets the gap two blocks of prose have, the desktop's seam at the phone's larger text. A question
/// carries the gaps around it itself: the answer's under it and, after the first, the turn's over it.
struct ChatRowPadding: Equatable {
    static let prose: CGFloat = 10
    static let work: CGFloat = 2
    static let answer: CGFloat = 16
    static let turn: CGFloat = 30

    let top: CGFloat
    let bottom: CGFloat

    static func rows(_ rhythm: [ChatRowRhythm]) -> [ChatRowPadding] {
        rhythm.indices.map { index in
            switch rhythm[index] {
            case .question: return ChatRowPadding(top: index == 0 ? prose : turn, bottom: answer)
            case .block: return ChatRowPadding(top: prose, bottom: prose)
            // A run of sent messages sits as tight as work lines, so a fan-out reads as one stretch.
            case .sent:
                let above = index > 0 && rhythm[index - 1] == .sent
                let below = index + 1 < rhythm.count && rhythm[index + 1] == .sent
                return ChatRowPadding(top: above ? Self.work : prose, bottom: below ? Self.work : prose)
            case .work:
                let above = index > 0 && rhythm[index - 1] != .work
                let below = index + 1 < rhythm.count && rhythm[index + 1] != .work
                return ChatRowPadding(top: above ? prose : Self.work, bottom: below ? prose : Self.work)
            }
        }
    }
}

@MainActor @Observable
final class ChatPresentation {
    private(set) var entries: [ChatTimelineEntry] = []
    private(set) var revision = 0
    private(set) var info: ChatInfo?
    /// Where the thread's paths resolve. A sub-agent's thread has no info of its own and borrows its chat's folder.
    private(set) var cwd = ""
    private(set) var connected = false
    private(set) var startedAt: Double?
    private(set) var activityLabel = String(localized: "Working for", comment: "Followed by a running clock")
    private(set) var isAnimating = false
    @ObservationIgnored private var order: [String] = []
    @ObservationIgnored private var records: [String: ChatItemState] = [:]
    private(set) var expandedTurns: Set<String> = []
    /// The runs of calls opened, by entry id, kept here so an open run stays open when its cell is reused.
    private(set) var expandedGroups: Set<String> = []
    private(set) var expandedSubagents: Set<String> = []
    /// Leaves the tool lines out, as the desktop's "Show what an agent reads and runs" turned off does; a settled turn
    /// still says how long it worked.
    private(set) var hidesToolCalls = false
    private(set) var requestedItemID: String?
    /// A subagent row asked to open its conversation; the screen that shows this timeline pushes it.
    var conversationRequest: SubagentCrumb?
    /// Whether this is a chat's own thread, which can fork; a sub-agent's thread in its place cannot.
    @ObservationIgnored var forkable = false
    /// The machine whose `provider.list` says whether this chat's CLI forks.
    @ObservationIgnored weak var machine: (any MachineRequesting)?
    /// A row asked to fork after this turn; the screen shows the fork sheet.
    var forkRequest: ChatForkRequest?
    /// A row asked to open another chat of the project (a summary's fork); the screen pushes it.
    var openRequest: String?
    /// A note asked for the card of an agent this chat opened outside every view; the screen brings it to the front.
    var promptRequest: String?
    /// The forks this device knows of per turn, for the line under the turn.
    private(set) var forks: [String: [String]] = [:]
    var places: ChatPlaces?
    /// What a person pointed at with `#` in this thread, which a reply's `#Name` wins over another of the same name.
    private(set) var referenced: [String] = []
    @ObservationIgnored var agentSources: ChatAgentSources?
    /// The catalog of the chat's own CLI, which names the models and efforts a selection switch moved between.
    @ObservationIgnored var chatModels: () -> [ProviderModel] = { [] }
    private(set) var bookmarks: [String: ChatBookmark] = [:]
    /// A row asked to place, name or take away a bookmark; the screen carries it out.
    var bookmarkRequest: ChatBookmarkRequest?
    var uiChoiceRequest: UiChoiceJump?
    var uiChoiceHighlight: UiChoiceJump?
    private(set) var visuals: [ChatVisual] = []
    /// A card asked to open its visual large or to remove it; the screen carries it out.
    var visualRequest: ChatVisualRequest?
    private(set) var saved: [ChatSavedVersion] = []
    /// A card asked to open an item of Output; the screen pushes it.
    var outputRequest: ChatOutputOpen?
    @ObservationIgnored let visualPages = ChatVisualPages()
    /// Whether the machine holds a page of the thread before the first item here, which a visual from before that
    /// item waits for.
    @ObservationIgnored var earlierPageWaits = false
    /// The timeline entries on screen, answered by the timeline while it is there.
    @ObservationIgnored var visibleEntryIDs: () -> [String] = { [] }
    private(set) var scrollRequest = 0
    /// The row a jump landed on, which lights up once.
    private(set) var flash: ChatRowFlash?
    /// A quote asked to lead back to the reply it quotes; the screen carries it out, since that reply may be on a page
    /// this thread has not read yet.
    private(set) var quoteRequest: ChatQuoteJump?
    private(set) var goneQuotes: Set<String> = []
    /// The calls that wait on a person's answer to an approval of them, by tool use id.
    private(set) var awaitingApproval: Set<String> = []
    /// The items that show the chat as waiting on a person, by item id; each needs a card in the composer.
    private(set) var holdingTurn: Set<String> = []
    @ObservationIgnored private var activeID: String?

    func replace(_ values: [ChatItem], info: ChatInfo?) {
        records = [:]
        order = []
        expandedTurns = []
        expandedGroups = []
        expandedSubagents = []
        for record in values.map(ChatItemState.init) {
            if records[record.id] == nil { order.append(record.id) }
            records[record.id] = record
        }
        setInfo(info)
    }

    /// An earlier page goes in front as it would have stood from the start: a turn it brings the start of folds, and a
    /// run of calls it continues joins it, as on the desktop.
    func prepend(_ values: [ChatItem]) {
        var older: [String] = []
        for record in values.map(ChatItemState.init) where records[record.id] == nil {
            records[record.id] = record
            older.append(record.id)
        }
        order = older + order
        rebuild()
    }

    func setInfo(_ info: ChatInfo?) {
        self.info = info
        if let info { cwd = info.cwd }
        refreshActivity()
        rebuild()
    }

    func setCwd(_ cwd: String) { self.cwd = cwd }

    func setConnected(_ connected: Bool) {
        self.connected = connected
        refreshActivity()
        rebuild()
    }

    func upsert(_ item: ChatItem, textOnly: Bool = false) {
        if let existing = records[item.id] {
            existing.update(item)
            if textOnly { return }
        } else {
            records[item.id] = ChatItemState(item)
            order.append(item.id)
        }
        refreshActivity()
        rebuild()
    }

    private func refreshActivity() {
        let nextID = info?.activeTurnId
        if activeID != nextID {
            activeID = nextID
            startedAt = nextID == nil ? nil : Date.now.timeIntervalSince1970 * 1000
        }
        if let nextID,
            let turn = order.lazy.compactMap({ self.records[$0].flatMap(Self.turn) }).first(where: {
                $0.turnId == nextID || $0.id == nextID
            })
        {
            startedAt = turn.createdAt
        }
        let holding = Set(records.values.filter(\.item.holdsTurn).map(\.id))
        if holding != holdingTurn { holdingTurn = holding }
        let blocked = !holding.isEmpty
        let awaiting = Set(
            records.values.compactMap { record -> String? in
                guard case .approval(let approval) = record.item, approval.decision == .pending else { return nil }
                return approval.toolUseId
            })
        if awaiting != awaitingApproval { awaitingApproval = awaiting }
        activityLabel =
            !connected
            ? String(localized: "Connection lost")
            : blocked
                ? String(localized: "Waiting for you")
                : String(localized: "Working for", comment: "Followed by a running clock")
        isAnimating = connected && !blocked && nextID != nil
    }

    func item(_ id: String) -> ChatItem? { records[id]?.item }

    var values: [ChatItem] { order.compactMap { records[$0]?.item } }

    /// The last turn that ended, which is where a fork from the conversation menu goes on after. Read from the end,
    /// since the screen asks on every render.
    var lastSettledTurnID: String? {
        for id in order.reversed() {
            if let turn = records[id].flatMap(Self.turn), turn.state != .running { return turn.id }
        }
        return nil
    }

    func setForks(_ forks: [String: [String]]) {
        guard forks != self.forks else { return }
        self.forks = forks
        rebuild()
    }

    func forkRefusal(turnID: String) -> String? {
        let cliCanFork = info.flatMap { info in machine.map { AgentDirectory.shared.canFork(info.provider, on: $0) } }
        return ChatForking.refusal(info: info, turn: records[turnID]?.item, cliCanFork: cliCanFork ?? true)
    }

    /// Scrolls the timeline to an entry, as the message index asks; a jump that searched for it lights it up.
    func reveal(entryID: String, flashing: Bool = false) {
        requestedItemID = entryID
        scrollRequest += 1
        if flashing { flash = ChatRowFlash(entryID: entryID) }
    }

    /// Scrolls to a message, unfolding the turn that hides it. False while the message is not loaded.
    func revealItem(_ id: String, flashing: Bool = false) -> Bool {
        guard let record = records[id] else { return false }
        if !entries.contains(where: { $0.id == id }), let turnID = record.item.turnId {
            expandedTurns.insert(turnID)
            rebuild()
        }
        reveal(entryID: id, flashing: flashing)
        return true
    }

    /// Asks to lead a quote in a message back to the reply it quotes, which the screen then looks for.
    func requestQuote(messageID: String, sourceID: String) {
        goneQuotes.remove(messageID)
        quoteRequest = ChatQuoteJump(messageID: messageID, sourceID: sourceID)
    }

    /// Settles a quote's jump; one whose reply is gone says so on its message.
    func finishQuote(_ jump: ChatQuoteJump, gone: Bool) {
        if gone { goneQuotes.insert(jump.messageID) }
        if quoteRequest == jump { quoteRequest = nil }
    }

    func setVisuals(_ visuals: [ChatVisual]) {
        guard visuals != self.visuals else { return }
        self.visuals = visuals
        rebuild()
    }

    func setSaved(_ saved: [ChatSavedVersion]) {
        guard saved != self.saved else { return }
        self.saved = saved
        rebuild()
    }

    func setBookmarks(_ bookmarks: [ChatBookmark]) {
        let next = Dictionary(bookmarks.map { ($0.itemID, $0) }, uniquingKeysWith: { first, _ in first })
        if next != self.bookmarks { self.bookmarks = next }
    }

    /// The bookmarks in the order of the thread; one on a message this device has not loaded goes last.
    var orderedBookmarks: [ChatBookmark] {
        ChatBookmarks.inThreadOrder(Array(bookmarks.values), order: order)
    }

    func toggleTurn(_ id: String) {
        if !expandedTurns.insert(id).inserted { expandedTurns.remove(id) }
        rebuild()
    }

    func toggleGroup(_ id: String) {
        if !expandedGroups.insert(id).inserted { expandedGroups.remove(id) }
    }

    func setHidesToolCalls(_ hides: Bool) {
        guard hides != hidesToolCalls else { return }
        hidesToolCalls = hides
        rebuild()
    }

    func toggleSubagent(_ id: String) {
        if !expandedSubagents.insert(id).inserted { expandedSubagents.remove(id) }
    }

    /// The row of the sub-agent a call opened; a view that reads its value follows it as it changes.
    func subagent(toolUseID: String) -> ChatItemState? {
        records.values.first {
            if case .subagent(let agent) = $0.item { agent.toolUseId == toolUseID } else { false }
        }
    }

    func openSubagent(toolUseID: String) {
        guard let agent = subagent(toolUseID: toolUseID) else { return }
        expandedSubagents.insert(agent.id)
        if let turnID = agent.item.turnId { expandedTurns.insert(turnID) }
        rebuild()
        // An agent another agent opened is drawn in the row of the one that opened it.
        requestedItemID = entries.first { $0.branch?.contains(toolUseID: toolUseID) == true }?.id ?? agent.id
        scrollRequest += 1
    }

    private func rebuild() {
        let all = order.compactMap { records[$0] }
        let pointed = ChatReferables.referenced(all.map(\.item))
        if pointed != referenced { referenced = pointed }
        let children = Dictionary(grouping: all.filter { $0.item.parentToolUseID != nil }) {
            $0.item.parentToolUseID!
        }
        var chunks: [(String?, [ChatItemState])] = []
        var positions: [String: Int] = [:]
        for item in all {
            if let turnID = item.item.turnId {
                if let index = positions[turnID] {
                    chunks[index].1.append(item)
                } else {
                    positions[turnID] = chunks.count
                    chunks.append((turnID, [item]))
                }
            } else if chunks.last?.0 == nil && !chunks.isEmpty {
                chunks[chunks.count - 1].1.append(item)
            } else {
                chunks.append((nil, [item]))
            }
        }
        var rows: [ChatTimelineEntry] = []
        var selection: ChatTurnItemSelection?
        for (turnID, items) in chunks {
            guard let turnID else {
                rows += shown(rowsFor(items, children: children))
                continue
            }
            let turn = items.first { Self.turn($0) != nil }
            let turnItem = turn.flatMap(Self.turn)
            if let turn, let turnItem {
                // A turn without a selection (older ones, or one the CLI started on its own) compares the next with
                // the one before it.
                if let next = turnItem.selection {
                    if let selection, ChatSelectionSwitch.switches(from: selection, to: next) {
                        rows.append(
                            ChatTimelineEntry(
                                id: "switch-\(turnID)", kind: .selectionSwitch, items: [turn], switchedFrom: selection))
                    }
                    selection = next
                }
                // A turn a message opened needs no line of its own when that message stands right above it.
                if turnItem.origin == .agent && !Self.opensUnderItsMessages(turnItem, rows: rows) {
                    rows.append(ChatTimelineEntry(id: "start-\(turnID)", kind: .turnStart, items: [turn]))
                }
            }
            let conversation = items.filter { Self.turn($0) == nil }
            let active = turnID == activeID || turnItem?.state == .running
            guard let turn, let turnItem, !active else {
                let live = shown(rowsFor(conversation, children: children))
                rows += active ? Self.withLiveThought(live, items: conversation) : live
                if active { rows.append(Self.workingRow(turnID: turnID, turn: turn, conversation: conversation)) }
                continue
            }
            // Steering splits the conversation inside a turn. Earlier responses keep their place above it.
            let split = (conversation.lastIndex { if case .user = $0.item { true } else { false } } ?? -1) + 1
            rows += shown(rowsFor(Array(conversation[..<split]), children: children))
            let work = Array(conversation[split...])
            let workRows = rowsFor(work, children: children)
            // The closing answer stays in sight; the work after the last input folds behind the label.
            // A turn the machine ended mid-call has no closing answer, but what it last said is still the most a person
            // can read of it.
            let cutShort = turnItem.state == .aborted && Self.abortedByMachine(turnItem, items: items.map(\.item))
            let answer =
                Self.closingAnswer(workRows)
                ?? (cutShort
                    ? workRows.lastIndex { $0.kind == .message && $0.items.first?.item.assistantItem != nil } : nil)
            let before = Array(workRows[..<(answer ?? workRows.count)])
            let standing = before.filter(Self.stands)
            let standingIDs = Set(standing.map(\.id))
            // With the tool lines left out, a turn that only ran tools has nothing behind its fold to open.
            let visible = shown(before)
            let expandable = visible.contains { !standingIDs.contains($0.id) }
            if before.count > standing.count {
                let notes = conversation.filter { $0.item.noteItem != nil }
                let tools = work.filter {
                    guard let tool = $0.item.toolItem else { return false }
                    return $0.item.parentToolUseID == nil && ChatSubagents.handbackReport($0.item) == nil
                        && !UiGeneratedImage.isGeneration(tool)
                }
                var fold = ChatTimelineEntry(id: "fold-\(turnID)", kind: .turnFold, items: [turn] + notes + tools)
                fold.expandable = expandable
                rows.append(fold)
            }
            rows += expandable && expandedTurns.contains(turnID) ? visible : standing
            let edits = conversation.filter {
                guard case .tool(let tool) = $0.item else { return false }
                return tool.state == .done && ChatToolPresentation.changesFiles(tool.name)
                    && ChatFileChanges.hasChanges(tool)
            }
            let changed = turnItem.checkpointDiff.map { !$0.files.isEmpty } ?? !edits.isEmpty
            if changed {
                rows.append(ChatTimelineEntry(id: "files-\(turnID)", kind: .changedFiles, items: [turn] + edits))
            }
            if let answer { rows += workRows[answer...] }
            if forks[turnID]?.isEmpty == false {
                rows.append(ChatTimelineEntry(id: "forks-\(turnID)", kind: .forks, items: [turn]))
            }
        }
        let heldFrom = earlierPageWaits ? order.first.flatMap { records[$0]?.item.createdAt } : nil
        let itemTimes = all.map(\.item.createdAt)
        // Output survives a clear; only versions from the conversation still in this thread belong here.
        let from = itemTimes.min() ?? .infinity
        let visibleSaved = saved.filter { $0.version.created >= from }
        let groups = ChatOutputCards.groups(visibleSaved, itemTimes: itemTimes)
        let cards = groups.map(ChatOutputCard.init(saved:))
        rows = ChatVisuals.placed(rows, visuals: visuals, cards: cards, heldFrom: heldFrom)
        guard rows != entries else { return }
        entries = rows
        revision += 1
    }

    /// The rows without the tool lines while they are hidden; a generated image reads as the turn's result and stays.
    private func shown(_ rows: [ChatTimelineEntry]) -> [ChatTimelineEntry] {
        hidesToolCalls ? rows.filter { $0.kind != .tools } : rows
    }

    /// The working row closing a running turn, under the mark of the call it runs last; a sub-agent's call is its own.
    private static func workingRow(turnID: String, turn: ChatItemState?, conversation: [ChatItemState])
        -> ChatTimelineEntry
    {
        let call = conversation.last {
            $0.item.toolItem?.state == .running && $0.item.parentToolUseID == nil
        }
        return ChatTimelineEntry(id: "working-\(turnID)", kind: .activity, items: [turn, call].compactMap { $0 })
    }

    /// The rows of a running turn with its latest thought repeated over the call it led to, which is a running image
    /// since every other call joins its run. Nothing while no finished call stands between the thought's own row and
    /// that call, since the thought still shows there, or when a newer thought came after the call.
    static func withLiveThought(_ rows: [ChatTimelineEntry], items: [ChatItemState]) -> [ChatTimelineEntry] {
        guard
            let at = items.lastIndex(where: {
                if case .thinking = $0.item { $0.item.parentToolUseID == nil } else { false }
            }),
            case .thinking(let thought) = items[at].item, !ChatThought.line(thought.text).isEmpty
        else { return rows }
        let after = Set(items[(at + 1)...].map(\.id))
        let image = { (row: ChatTimelineEntry) -> ChatToolItem? in
            guard row.kind == .message, let tool = row.items.first?.item.toolItem, UiGeneratedImage.isGeneration(tool)
            else { return nil }
            return tool
        }
        let call = rows.firstIndex {
            guard let record = $0.items.first, let tool = image($0) else { return false }
            return after.contains(record.id) && tool.state == .running
        }
        guard let call else { return rows }
        if let shown = rows.firstIndex(where: { $0.id == items[at].id }), shown < call,
            !rows[(shown + 1)..<call].contains(where: { $0.kind == .tools || image($0).map { $0.state != .running } == true })
        {
            return rows
        }
        var next = rows
        let entry = ChatTimelineEntry(
            id: "live-thought-\(items[at].id)", kind: .liveThought, items: [items[at]] + rows[call].items.prefix(1))
        next.insert(entry, at: call)
        return next
    }

    private static func turn(_ record: ChatItemState) -> ChatTurnItem? {
        if case .turn(let turn) = record.item { turn } else { nil }
    }

    /// The closing answer of a settled turn, by its place in the turn's rows. A turn may end on a call the person turned
    /// down, as an agent that stops there does: the answer before it closes the turn, and the refused call and its
    /// denial stay in sight with it. Anything else after the last answer folds the whole turn, a message another node
    /// sent included; only a plain note does not.
    static func closingAnswer(_ rows: [ChatTimelineEntry]) -> Int? {
        var refused = Set<String>()
        for index in rows.indices.reversed() {
            let row = rows[index]
            switch row.items.first?.item {
            case .assistant? where row.kind == .message:
                return index
            case .approval(let approval)? where row.kind == .message && approval.decision == .deny:
                guard let toolUseID = approval.toolUseId else { return nil }
                refused.insert(toolUseID)
            case .tool(let tool)? where row.kind == .tools && row.items.count == 1 && refused.contains(tool.toolUseId):
                continue
            case .note(let note)? where row.kind == .message && note.message == nil:
                continue
            case .tool(let tool)? where row.kind == .message && UiGeneratedImage.isGeneration(tool):
                continue
            default:
                return nil
            }
        }
        return nil
    }

    /// Images and sub-agents stay a turn's visible result, and a workflow may still run after its turn ended. A
    /// compaction is never folded away, so a turn that only compacted shows its divider and no fold.
    private static func stands(_ row: ChatTimelineEntry) -> Bool {
        switch row.items.first?.item {
        case .compaction? where row.kind == .message: true
        case .tool(let tool)? where row.kind == .message:
            UiGeneratedImage.isGeneration(tool) || tool.workflow != nil && tool.state == .running
        case .compaction? where row.kind == .message: true
        case .subagent? where row.kind == .subagent: true
        default: false
        }
    }

    /// The first call anchors the group so completing calls never moves them between rows.
    private func rowsFor(_ items: [ChatItemState], children: [String: [ChatItemState]]) -> [ChatTimelineEntry] {
        var rows: [ChatTimelineEntry] = []
        var calls: [ChatItemState] = []
        func flush() {
            if let first = calls.first {
                rows.append(ChatTimelineEntry(id: "tools-\(first.id)", kind: .tools, items: calls))
            }
            calls = []
        }
        for item in items where item.item.parentToolUseID == nil {
            // A subagent's `SubagentHandback` call reads as the report it carries rather than as a tool call.
            if case .tool(let tool) = item.item, tool.workflow == nil, ChatSubagents.handbackReport(item.item) == nil,
                !UiGeneratedImage.isGeneration(tool), RuimteCommandLook.sent(of: tool) == nil
            {
                calls.append(item)
                continue
            }
            flush()
            switch item.item {
            case .turn: continue
            case .subagent:
                let branch = ChatSubagentBranch(item, children: children)
                rows.append(ChatTimelineEntry(id: item.id, kind: .subagent, items: branch.records, branch: branch))
            case .assistant(let reply) where reply.text.isEmpty && !reply.streaming: continue
            default:
                if !item.item.isPending { rows.append(ChatTimelineEntry(id: item.id, kind: .message, items: [item])) }
            }
        }
        flush()
        return rows
    }

    /// The notes of the turn tell a turn a person stopped from one the machine ended after a restart.
    static func turnLabel(_ turn: ChatTurnItem, items: [ChatItem] = []) -> String {
        let duration = Format.elapsedShort(milliseconds: (turn.endedAt ?? turn.createdAt) - turn.createdAt)
        switch turn.state {
        case .error: return String(localized: "Failed after \(duration)")
        case .aborted:
            return abortedByMachine(turn, items: items)
                ? String(localized: "Stopped after \(duration)") : String(localized: "You stopped after \(duration)")
        case .running, .done: return String(localized: "Worked for \(duration)")
        }
    }

    // The daemon's warning note in a turn it could not resume, `notResumedNote` in the contracts.
    private static let notResumedPrefix = "This turn could not be resumed after the machine restarted: "

    static func abortedByMachine(_ turn: ChatTurnItem, items: [ChatItem]) -> Bool {
        let turnID = turn.turnId ?? turn.id
        return turn.state == .aborted
            && items.contains {
                guard let note = $0.noteItem else { return false }
                return note.turnId == turnID && note.level == .warning && note.text.hasPrefix(notResumedPrefix)
            }
    }

    /// Whether every node whose message opened the turn has that message among the rows right above it.
    static func opensUnderItsMessages(_ turn: ChatTurnItem, rows: [ChatTimelineEntry]) -> Bool {
        let from = turn.messageFrom ?? []
        guard !from.isEmpty else { return false }
        var senders = Set<String>()
        for row in rows.reversed() {
            guard row.kind == .message, case .note(let note)? = row.items.first?.item, let message = note.message
            else { break }
            senders.insert(message.from)
        }
        return from.allSatisfy(senders.contains)
    }

    /// The header of a turn the chat did not start from a person's message.
    static func agentTurnLabel(_ turn: ChatTurnItem) -> String {
        let label = turn.label ?? ""
        let tasks = turn.taskIds?.count ?? 0
        if tasks > 0 {
            // A turn the machine opened with the results of tasks this chat gave; the label is their titles.
            return label.isEmpty
                ? String(localized: "Woken by \(tasks) tasks") : String(localized: "Woken by \(tasks) tasks: \(label)")
        }
        let messages = turn.messageFrom?.count ?? 0
        if messages > 0 {
            // A turn the machine opened over messages other nodes sent; the label names who sent them.
            return label.isEmpty
                ? String(localized: "Woken by \(messages) messages")
                : String(localized: "Woken by \(messages) messages: \(label)")
        }
        if label.isEmpty { return String(localized: "Continued on its own") }
        // The machine names the sub-agent row a wake is about; the CLI also wakes the agent for a command, a monitor or a
        // workflow it ran in the background, which has no such row.
        return turn.taskToolUseId == nil
            ? String(localized: "Background task finished: \(label)") : String(localized: "Sub-agent finished: \(label)")
    }
}

enum ChatToolPresentation {
    static func summary(_ tool: ChatToolItem) -> String { summary(name: tool.name, input: tool.input) }

    /// What a call is about, also for one that is only asked for, as an approval names it.
    static func summary(name: String, input: JSONValue) -> String {
        guard let fields = input.objectValue else { return "" }
        guard let keys = summaryKeys[name] else {
            // A tool nobody named shows whatever string it was called with, as chat/logic/tools.ts does. That reads
            // the input in the order the CLI wrote it; a decoded object has no order, so the keys decide instead.
            return fields.keys.sorted().compactMap { fields[$0]?.stringValue }.first ?? ""
        }
        return keys.compactMap { fields[$0]?.stringValue }.first ?? ""
    }

    // The input keys that hold the line saying what a call is about, best first: `TOOL_CATALOG` in ADE CORE.
    private static let summaryKeys: [String: [String]] = [
        "Read": ["file_path"], "NotebookRead": ["file_path", "notebook_path"], "Edit": ["file_path"],
        "Write": ["file_path"], "MultiEdit": ["file_path"], "NotebookEdit": ["file_path", "notebook_path"],
        "ApplyPatch": ["summary"], "Bash": ["description", "command"], "Grep": ["pattern"], "Glob": ["pattern"],
        "WebFetch": ["url", "query"], "WebSearch": ["url", "query"], "Task": ["description"],
        "Agent": ["description"], "Skill": ["skill"], "TodoWrite": [], "Workflow": [],
    ]

    /// Whether the summary of a call is the path of a file, which a row cuts in the middle so the name stays.
    static func summaryIsPath(_ tool: ChatToolItem) -> Bool { summaryIsPath(name: tool.name, input: tool.input) }

    static func summaryIsPath(name: String, input: JSONValue) -> Bool {
        guard let keys = summaryKeys[name], input.objectValue != nil,
            let key = keys.first(where: { input[$0]?.stringValue != nil })
        else { return false }
        return key == "file_path" || key == "notebook_path"
    }

    /// The detail on a call's line. A live call that names nothing in its input says what its progress reports.
    static func lineDetail(_ tool: ChatToolItem) -> String {
        let summary = summary(tool)
        guard summary.isEmpty, tool.state == .running else { return summary }
        return tool.progress?.description ?? ""
    }

    /// The mark of a call, as `toolIcon` in `@adecore/agents-react` draws it; a tool nobody named gets the wrench.
    static func icon(_ name: String) -> String {
        switch name {
        case "Read", "NotebookRead": "eye"
        case "Edit", "MultiEdit", "Write", "NotebookEdit", "ApplyPatch": "square-pen"
        case "Bash": "terminal"
        case "Grep": "search"
        case "Glob": "folder-search"
        case "WebFetch", "WebSearch": "globe"
        case "Task", "Agent": "bot"
        case "Skill": "zap"
        case "TodoWrite": "list-todo"
        case "Workflow": "workflow"
        case "ImageGeneration": "image"
        default: name.hasPrefix("mcp__") ? "hammer" : "wrench"
        }
    }

    static func mark(_ tool: ChatToolItem) -> ChatToolMark {
        RuimteCommandLook.run(of: tool) == nil ? .lucide(icon(tool.name)) : .ruimte
    }

    /// The mark of a run of calls, as `WorkGroupRow` draws it: the call running last, else Ruimte's when the run is
    /// one look's, else what the first call's tool is about.
    static func groupMark(_ tools: [ChatToolItem]) -> ChatToolMark {
        if let latest = tools.last(where: { $0.state == .running }) { return mark(latest) }
        if lookLabel(tools) != nil { return .ruimte }
        return .lucide(icon(tools.first?.name ?? ""))
    }

    /// The last twelve lines of a running call's output, in the colors set before them. Only the last 32,000
    /// characters are read, so a long run stays cheap to draw on every update.
    static func tail(_ tool: ChatToolItem) -> [ChatAnsiToken] {
        let output = String((tool.progress?.output ?? "").suffix(32_000))
        return ChatAnsi.parse(output, tailLines: 12).tokens
    }

    /// What a folded turn did, a sentence per kind of call in the order it first came, as `summarizeTurn` in
    /// `chat/logic/timeline.ts` writes it: every file change is one sentence, calls without one are counted last.
    static func turnSummary(_ tools: [ChatToolItem]) -> [ChatToolSentence] {
        var order: [String] = []
        var counts: [String: Int] = [:]
        var edited = Set<String>()
        var other = 0
        for tool in tools {
            let name = tool.name
            let key: String
            if let sent = RuimteCommandLook.sent(of: tool) {
                guard sent.state != .failed else {
                    other += 1
                    continue
                }
                key = "sent"
            } else if let run = RuimteCommandLook.run(of: tool), let group = run.groupKey {
                // Keyed by the look too, so the command and the MCP tool keep their own sentences.
                key = "look:\(lookKey(run)):\(group)"
            } else if failedFileChange(tool) {
                other += 1
                continue
            } else if fileChanges.contains(name) {
                edited.insert(tool.input["file_path"]?.stringValue ?? tool.id)
                key = "edited"
            } else if sentenceNames.contains(name) {
                key = name
            } else {
                other += 1
                continue
            }
            if counts[key] == nil { order.append(key) }
            counts[key, default: 0] += 1
        }
        var parts = order.map { key in
            let count = counts[key] ?? 0
            if key.hasPrefix("look:") {
                return usedRuimte(String(key.split(separator: ":", maxSplits: 2)[2]), count: count)
            }
            if key == "sent" { return ChatToolSentence(text: String(localized: "Sent \(count) messages")) }
            return ChatToolSentence(
                text: key == "edited" ? String(localized: "Edited \(edited.count) files") : sentence(key, count: count))
        }
        if other > 0 {
            parts.append(
                ChatToolSentence(
                    text: parts.isEmpty
                        ? String(localized: "\(other) tool calls") : String(localized: "\(other) other tool calls")))
        }
        return parts
    }

    /// The work of a folded turn after its time: "· Read 2 files · Ran 3 commands".
    static func turnLine(_ parts: [ChatToolSentence]) -> AttributedString {
        parts.reduce(into: AttributedString()) { line, part in
            line += AttributedString(line.characters.isEmpty ? "· " : " · ")
            line += part.attributed
        }
    }

    private static let fileChanges: Set<String> = ["Edit", "Write", "MultiEdit", "ApplyPatch"]

    /// Whether a call by this name writes to a file, which is what a mixed run of calls is named after.
    static func changesFiles(_ name: String) -> Bool { fileChanges.contains(name) }

    /// A file change that failed or was refused changed nothing: it counts as a call, never as an edit.
    private static func failedFileChange(_ tool: ChatToolItem) -> Bool {
        fileChanges.contains(tool.name) && tool.state == .error
    }

    private static let sentenceNames: Set<String> = [
        "Read", "NotebookEdit", "Bash", "Grep", "Glob", "WebFetch", "WebSearch", "Task", "Agent", "Skill", "TodoWrite",
    ]

    // The sentences of `chat:group.tools` in the client's English locale.
    private static func sentence(_ name: String, count: Int) -> String {
        switch name {
        case "Read": String(localized: "Read \(count) files")
        case "Write": String(localized: "Wrote \(count) files")
        case "NotebookEdit": String(localized: "Edited \(count) notebooks")
        case "Bash": String(localized: "Ran \(count) commands")
        case "Grep": String(localized: "Searched \(count) patterns")
        case "Glob": String(localized: "Listed \(count) patterns")
        case "WebFetch": String(localized: "Fetched \(count) pages")
        case "WebSearch": String(localized: "Ran \(count) web searches")
        case "Task", "Agent": String(localized: "Delegated \(count) tasks")
        case "Skill": String(localized: "Used \(count) skills")
        case "TodoWrite": String(localized: "Updated \(count) plans")
        default: String(localized: "\(count) tool calls")
        }
    }

    /// How many calls of a run failed, said apart from the run's line in the error tone; nil when none did.
    static func groupFailures(_ tools: [ChatToolItem]) -> String? {
        let failed = tools.filter { $0.state == .error }.count
        return failed == 0 ? nil : String(localized: "\(failed) failed")
    }

    /// The line of a run of calls, as `summarizeGroup` in `chat/logic/timeline.ts` writes it: a run of
    /// `ruimte-context` calls as using Ruimte, and edits by the files they touched rather than the calls.
    static func groupLabel(_ tools: [ChatToolItem]) -> ChatToolSentence {
        let count = tools.count
        if let looked = lookLabel(tools) { return looked }
        let names = Set(tools.map(\.name))
        let only = names.count == 1 ? names.first : nil
        let failed = tools.filter(failedFileChange).count
        if let only, sentenceNames.contains(only) || only == "Write", failed == 0 {
            return ChatToolSentence(text: sentence(only, count: count))
        }
        if tools.allSatisfy({ fileChanges.contains($0.name) }), failed < count {
            let paths = Set(tools.filter { !failedFileChange($0) }.map { $0.input["file_path"]?.stringValue ?? $0.id })
            return ChatToolSentence(text: String(localized: "Edited \(paths.count) files"))
        }
        if let only {
            return ChatToolSentence(
                text: String(localized: "\(only) \(count) calls", comment: "%@ is the name of a tool"))
        }
        return ChatToolSentence(text: String(localized: "\(count) tool calls"))
    }

    /// Ruimte's command and its MCP server are two looks on the desktop, which never call a run of both one look's.
    private static func lookKey(_ run: RuimteCommandRun) -> String { run.mcp == nil ? "command" : "tool" }

    /// A run whose calls are all runs of one look: named after the part they share, else after Ruimte alone.
    private static func lookLabel(_ tools: [ChatToolItem]) -> ChatToolSentence? {
        let runs = tools.map(RuimteCommandLook.run(of:))
        guard let first = runs.first, let first,
            runs.allSatisfy({ $0.map { lookKey($0) == lookKey(first) } == true })
        else { return nil }
        if let key = first.groupKey, runs.allSatisfy({ $0?.groupKey == key }) {
            return usedRuimte(key, count: tools.count)
        }
        return ChatToolSentence(text: String(localized: "Used Ruimte \(tools.count) times"), branded: true)
    }

    private static func usedRuimte(_ name: String, count: Int) -> ChatToolSentence {
        ChatToolSentence(
            text: String(
                localized: "Used Ruimte \(name) \(count) times", comment: "%@ is the name of a part of Ruimte"),
            branded: true)
    }
}

enum ChatToolMark: Equatable {
    case lucide(String)
    case ruimte
}

/// A sentence about calls; one that names Ruimte draws its name in bold, as the desktop does.
struct ChatToolSentence: Equatable {
    let text: String
    var branded = false

    var attributed: AttributedString {
        branded ? RuimteCommandLook.emphasizingBrand(text) : AttributedString(text)
    }
}
