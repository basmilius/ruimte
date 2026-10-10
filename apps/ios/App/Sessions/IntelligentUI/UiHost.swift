import Foundation
import Observation
import RuimteIntelligentUI
import RuimtePulsar
import SwiftUI

/// What the screen around a block lends it. Left out, a link stays a chip that opens nothing, a source opens in an
/// in-app browser and every block reads as disconnected, so its choices stay closed and nothing is read live.
struct UiHost {
    /// The project a link must lie in before it opens; `UiLinkDestination.parse` checks it against the daemon's reading.
    var projectID: String?
    var connected = false
    /// Opens a file, diff, commit or node the daemon resolved again at the tap.
    var open: (@MainActor (UiLinkDestination) -> Void)?
    /// Opens a Source or a link in prose, always HTTP(S) and always after a tap.
    var openURL: (@MainActor (URL) -> Void)?
}

extension EnvironmentValues {
    @Entry var uiHost = UiHost()
}

/// Keeps the model of a block alive while its row scrolls out and back, so local input, a pending choice and its
/// live readings survive cell reuse. The least recently used of `limit` goes first, as the desktop keeps 64.
@MainActor final class UiBlockModelCache {
    private let limit: Int
    private let make: @MainActor (_ itemID: String, _ block: JSONValue) -> UiBlockModel
    private var models: [String: UiBlockModel] = [:]
    private var order: [String] = []

    init(limit: Int = 64, make: @escaping @MainActor (_ itemID: String, _ block: JSONValue) -> UiBlockModel) {
        self.limit = limit
        self.make = make
    }

    func model(itemID: String, block: JSONValue) -> UiBlockModel {
        let key = "\(itemID)\n\(block["id"]?.stringValue ?? "")"
        order.removeAll { $0 == key }
        order.append(key)
        if let model = models[key] { return model }
        let model = make(itemID, block)
        models[key] = model
        while order.count > limit {
            let evicted = order.removeFirst()
            models.removeValue(forKey: evicted)?.stop()
        }
        return model
    }
}

/// What a person opened or picked in a block that only this screen needs: the tab that is open, the sections they
/// folded, a table shown whole. Kept beside the model by the block's key, so a reused row draws it the same.
@MainActor @Observable final class UiBlockLocal {
    private var flags: [String: Bool] = [:]
    private var picks: [String: String] = [:]

    func flag(_ key: String) -> Bool? { flags[key] }
    func setFlag(_ key: String, _ value: Bool) { flags[key] = value }
    func pick(_ key: String) -> String? { picks[key] }
    func setPick(_ key: String, _ value: String) { picks[key] = value }

    private static var cache: [String: UiBlockLocal] = [:]
    private static var order: [String] = []

    static func shared(_ key: String) -> UiBlockLocal {
        order.removeAll { $0 == key }
        order.append(key)
        if let local = cache[key] { return local }
        let local = UiBlockLocal()
        cache[key] = local
        if order.count > 64 { cache.removeValue(forKey: order.removeFirst()) }
        return local
    }
}

/// What every renderer of one block knows besides its node.
@MainActor struct UiRenderContext {
    let model: UiBlockModel
    let local: UiBlockLocal
    let host: UiHost
    /// The `$text` nodes the agent wrote out, which read as inline Markdown.
    let written: Set<String>
    let headID: String?
    let catalogVersion: Int?

    /// Until the last compile nothing in the block can be chosen or changed.
    var streaming: Bool { !model.complete }
    /// While the block streams or reads live data, a running step spins; in a still block it is a dot.
    var live: Bool {
        streaming
            || UiLiveStatus.of(
                block: model.block, order: model.queryNames, readings: model.readings, reading: model.reading
            )
            .map { $0.state != .refused } == true
    }

    /// An input changes only through its binding, once its own node closed and nothing was chosen yet.
    func editable(_ node: UiNode) -> Bool {
        node.bindings["value"] != nil && node.complete && model.complete && model.answer == nil && !model.sending
    }

    /// A Button runs its action under the same rules as an input, unless the agent disabled it.
    func runnable(_ node: UiNode) -> Bool {
        node.type == "Button" && node.bool("disabled") != true && node.complete && model.complete
            && model.answer == nil && !model.sending
    }

    func change(_ node: UiNode, to value: JSONValue) {
        guard editable(node) else { return }
        Task { await model.change(nodeID: node.id, prop: "value", value: value) }
    }

    /// Waits until the change is applied, so a control can let go of what it showed meanwhile.
    func apply(_ node: UiNode, _ value: JSONValue) async {
        guard editable(node) else { return }
        await model.change(nodeID: node.id, prop: "value", value: value)
    }

    /// Adds `item` to a Checklist's values or takes it out, against the values the changes before it left.
    func toggle(_ node: UiNode, item: JSONValue) {
        guard editable(node) else { return }
        Task {
            await model.change(nodeID: node.id, prop: "value") { current in
                let values = current?.arrayValue ?? []
                return .array(values.contains(item) ? values.filter { $0 != item } : values + [item])
            }
        }
    }

    func run(_ node: UiNode) {
        guard runnable(node) else { return }
        Task { await model.act(nodeID: node.id) }
    }
}
