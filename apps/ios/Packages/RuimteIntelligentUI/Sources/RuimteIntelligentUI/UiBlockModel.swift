import Foundation
import Observation
import RuimtePulsar

@MainActor @Observable
public final class UiBlockModel {
    public typealias Request = @MainActor @Sendable (String, JSONValue) async throws -> JSONValue
    public private(set) var block: JSONValue
    public private(set) var result: JSONValue = .object([:])
    public private(set) var values: JSONValue = .object([:])
    public private(set) var readings: [String: JSONValue] = [:]
    public private(set) var answer: JSONValue?
    public private(set) var sending = false
    public private(set) var reading = false
    public private(set) var error: String?
    public private(set) var failedChoiceID: String?
    public private(set) var connected = false
    public private(set) var queryInputsDirty = false
    public private(set) var resolvedLinks: [String: JSONValue] = [:]
    @ObservationIgnored private let chatID: String
    @ObservationIgnored private let itemID: String
    @ObservationIgnored private let request: Request
    @ObservationIgnored private let interpreter: UiInterpreter
    @ObservationIgnored private var queryValues: [String: JSONValue] = [:]
    @ObservationIgnored private var readTickets: [String: JSONValue] = [:]
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var evaluationGeneration = 0
    @ObservationIgnored private var visible = false
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var lastRead: ContinuousClock.Instant?
    @ObservationIgnored private var changes: Task<Void, Never>?
    @ObservationIgnored private var source = ""
    @ObservationIgnored private let inputSettle: Duration
    /// The read a changed input starts once it rested, as the desktop reads it.
    @ObservationIgnored private(set) var inputRead: Task<Void, Never>?

    public init(
        chatID: String, itemID: String, block: JSONValue, interpreter: UiInterpreter = .shared,
        inputSettle: Duration = .milliseconds(300), request: @escaping Request
    ) {
        self.chatID = chatID
        self.itemID = itemID
        self.block = block
        self.interpreter = interpreter
        self.inputSettle = inputSettle
        self.request = request
    }

    public var nodes: [JSONValue] { result["nodes"]?.arrayValue ?? [] }
    public var diagnostics: [JSONValue] { result["diagnostics"]?.arrayValue ?? [] }
    /// The block's queries in the order its source declares them, as the desktop reads them. The compiled block
    /// arrives as a dictionary that lost that order, so it comes from the source; what that misses is sorted.
    public var queryNames: [String] {
        let declared = Set((block["queries"]?.objectValue ?? [:]).keys)
        var ordered: [String] = []
        for name in Self.declarations(in: source) where declared.contains(name) && !ordered.contains(name) {
            ordered.append(name)
        }
        return ordered + declared.subtracting(ordered).sorted()
    }
    public var complete: Bool { block["complete"]?.boolValue == true && block["revision"]?.stringValue != nil }
    public var canChoose: Bool {
        complete && connected && !sending && !reading && !queryInputsDirty && answer == nil
            && (block["queries"]?.objectValue ?? [:]).keys.allSatisfy {
                readTickets[$0] != nil && readings[$0]?["state"] != .string("refused")
            }
    }
    public var answerState: String? {
        if sending { return "sending" }
        guard let answer else { return nil }
        return answer["state"]?.stringValue ?? (answer["queued"]?.boolValue == true ? "queued" : "sent")
    }

    /// `source` is the text of the block's fence, which only orders its queries.
    public func update(block: JSONValue, frozen: JSONValue? = nil, answered: JSONValue? = nil, source: String? = nil)
        async
    {
        if let source { self.source = source }
        let replaced = self.block != block
        if replaced { generation += 1 }
        let changed = self.block["id"] != block["id"] || self.block["revision"] != block["revision"]
        self.block = block
        if changed {
            values = .object([:])
            readings = [:]
            queryValues = [:]
            readTickets = [:]
            queryInputsDirty = false
            answer = nil
            lastRead = nil
            result = .object([:])
            resolvedLinks = [:]
        }
        if let frozen, frozen["revision"] == block["revision"] {
            for (name, reading) in frozen["readings"]?.objectValue ?? [:] where readings[name] == nil {
                readings[name] = reading
                if let value = reading["value"] { queryValues[name] = value }
                if let ticket = reading["readId"] { readTickets[name] = ticket }
            }
        }
        if let answered, answered["revision"] == block["revision"] {
            answer = answered
            values = answered["values"] ?? values
        }
        await evaluate()
        if let frozen, frozen["revision"] == block["revision"], resolvedLinks.isEmpty,
            (values.objectValue ?? [:]).allSatisfy({ block["defaults"]?[$0.key] == $0.value }),
            (frozen["readings"]?.objectValue ?? [:]).allSatisfy({ $0.value["value"] == queryValues[$0.key] })
        {
            resolvedLinks = frozen["links"]?.objectValue ?? [:]
        }
        if replaced { schedulePolling() }
    }

    public func setActive(visible: Bool, connected: Bool) {
        self.visible = visible
        self.connected = connected
        schedulePolling()
    }

    public func change(nodeID: String, prop: String, value: JSONValue) async {
        await change(nodeID: nodeID, prop: prop) { _ in value }
    }

    /// `update` gets the binding's value as the changes before it left it, so a fast second tap builds on the first.
    public func change(nodeID: String, prop: String, update: @escaping @MainActor (JSONValue?) -> JSONValue) async {
        await serialized {
            let current = Self.node(nodeID, in: self.nodes)?["bindings"]?[prop]?["value"]
            let change: JSONValue = .object([
                "nodeId": .string(nodeID), "prop": .string(prop), "value": update(current),
            ])
            await self.apply(change: change)
        }
    }

    /// Runs the local action of a Button: it changes local values only, like any input.
    public func act(nodeID: String) async {
        await serialized { await self.apply(action: nodeID) }
    }

    public func choose(nodeID: String) async {
        guard canChoose else { return }
        sending = true
        failedChoiceID = nil
        let revision = block["revision"]
        let blockID = block["id"]
        defer { sending = false }
        do {
            let response = try await request("chat.uiChoice", payload(["choiceId": .string(nodeID)]))
            guard revision == block["revision"], blockID == block["id"] else { return }
            answer = .object([
                "choiceId": .string(nodeID),
                "state": .string(response["queued"]?.boolValue == true ? "queued" : "sent"),
            ])
            error = nil
        } catch {
            guard revision == block["revision"], blockID == block["id"] else { return }
            failedChoiceID = nodeID
            self.error = String(describing: error)
        }
    }

    public func link(nodeID: String) async throws -> JSONValue {
        guard complete, connected else { throw UiInterpreterError.invalid("UI link unavailable") }
        // The daemon derives the target from its stored node and rechecks project access on every open.
        let current = generation
        let response = try await request("ui.link", payload(["nodeId": .string(nodeID)]))
        guard current == generation else { throw CancellationError() }
        resolvedLinks[nodeID] = response
        return response
    }

    public func refresh() async {
        guard visible, connected, complete, !reading, !(block["queries"]?.objectValue ?? [:]).isEmpty else { return }
        let now = ContinuousClock.now
        if let lastRead, lastRead.duration(to: now) < .seconds(10) { return }
        lastRead = now
        reading = true
        let current = generation
        let queriedValues = values
        let previousQueryValues = queryValues
        var allFresh = true
        defer { reading = false }
        for name in queryNames.prefix(8) {
            guard visible, connected, current == generation, !Task.isCancelled else { return }
            do {
                let response = try await request("ui.query", payload(["query": .string(name)]))
                guard visible, connected, current == generation, !Task.isCancelled else { return }
                readings[name] = response
                if response["state"] == .string("fresh"), let ticket = response["readId"], let value = response["value"]
                {
                    queryValues[name] = value
                    readTickets[name] = ticket
                } else {
                    allFresh = false
                }
            } catch {
                guard visible, connected, current == generation, !Task.isCancelled else { return }
                allFresh = false
                readings[name] = .object([
                    "state": .string("failed"), "readAt": .number(Date.now.timeIntervalSince1970 * 1000),
                    "reason": .string(String(describing: error)),
                ])
            }
        }
        await evaluate()
        if previousQueryValues != queryValues { resolvedLinks = [:] }
        if allFresh, queriedValues == values { queryInputsDirty = false }
    }

    public func stop() {
        visible = false
        generation += 1
        evaluationGeneration += 1
        polling?.cancel()
        polling = nil
        inputRead?.cancel()
        inputRead = nil
    }

    private func serialized(_ work: @escaping @MainActor () async -> Void) async {
        let previous = changes
        let next = Task { @MainActor in
            await previous?.value
            await work()
        }
        changes = next
        await next.value
    }

    private func apply(change: JSONValue? = nil, action: String? = nil) async {
        guard complete, answer == nil, !sending else { return }
        let previous = values
        generation += 1
        // A change the interpreter refuses leaves the block as it was; only a block that cannot be read says so.
        guard await evaluate(change: change, action: action, reportsFailure: false), previous != values else { return }
        resolvedLinks = [:]
        guard !(block["queries"]?.objectValue ?? [:]).isEmpty else { return }
        queryInputsDirty = true
        inputRead?.cancel()
        inputRead = Task { [weak self, inputSettle] in
            do { try await Task.sleep(for: inputSettle) } catch { return }
            while self?.reading == true {
                do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
            }
            guard let self, !Task.isCancelled else { return }
            self.lastRead = nil
            await self.refresh()
        }
    }

    @discardableResult
    private func evaluate(change: JSONValue? = nil, action: String? = nil, reportsFailure: Bool = true) async -> Bool {
        evaluationGeneration += 1
        let current = evaluationGeneration
        do {
            let result = try await interpreter.evaluate(
                block: block, values: values, queries: .object(queryValues), change: change, action: action)
            guard current == evaluationGeneration else { return false }
            self.result = result
            values = result["values"] ?? .object([:])
            error = nil
            return true
        } catch is CancellationError {
            // A view that went away or a newer compile canceled this one; it says nothing about the block.
            return false
        } catch {
            guard current == evaluationGeneration, reportsFailure else { return false }
            self.error = String(describing: error)
            return false
        }
    }

    private static func declarations(in source: String) -> [String] {
        source.matches(of: /(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*@Query\b/).map { String($0.output.1) }
    }

    private static func node(_ id: String, in nodes: [JSONValue]) -> JSONValue? {
        for node in nodes {
            if node["id"]?.stringValue == id { return node }
            if let found = Self.node(id, in: node["children"]?.arrayValue ?? []) { return found }
        }
        return nil
    }

    private func payload(_ extra: [String: JSONValue]) -> JSONValue {
        return .object(
            extra.merging(
                [
                    "chatId": .string(chatID), "itemId": .string(itemID), "blockId": block["id"] ?? .null,
                    "revision": block["revision"] ?? .null, "values": values, "reads": .object(readTickets),
                ], uniquingKeysWith: { _, identity in identity }))
    }

    private func schedulePolling() {
        polling?.cancel()
        guard visible, connected, complete, !(block["queries"]?.objectValue ?? [:]).isEmpty else {
            polling = nil
            return
        }
        polling = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                do { try await Task.sleep(for: .seconds(10)) } catch { return }
            }
        }
    }
}
