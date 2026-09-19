import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit

@MainActor @Observable
final class DrawingEditorModel {
    private(set) var document: JSONValue?
    private(set) var scene: JSONValue?
    private(set) var saving = false
    private(set) var history: [[JSONValue]] = []
    private(set) var future: [[JSONValue]] = []
    var selection: Set<String> = []
    var tool = DrawingTool.pan
    var toolLocked = false
    var additiveSelection = false
    var constrain = false
    var style = DrawingStyle()
    var exportBackground = false
    @ObservationIgnored var viewportCenter = CGPoint.zero
    var problem: String?
    private let client: any MachineRequesting
    private let target: JSONValue
    private let draftKey: String
    private var base: JSONValue?
    private var saveTask: Task<Void, Never>?
    private var renderTask: Task<Void, Never>?
    private var subscription: (() -> Void)?
    private var connection: (() -> Void)?
    private var generation = 0
    private var lifecycle = 0
    private var inFlightElements: [JSONValue]?
    private var lease: MachineSubscription?

    init(client: any MachineRequesting, machineID: String, projectID: String, viewID: String) {
        self.client = client
        target = .object(["projectId": .string(projectID), "viewId": .string(viewID)])
        draftKey = "drawing-draft:" + [machineID, projectID, viewID].joined(separator: ":")
        if let data = UserDefaults.standard.data(forKey: draftKey), let draft = try? JSONValue.decode(data) {
            base = draft["base"]
            document = draft["document"]
        }
    }

    var elements: [JSONValue] { document?.list("elements") ?? [] }
    var dirty: Bool { document?.list("elements") != base?.list("elements") }

    func start() async {
        lifecycle += 1
        if document != nil { render() }
        if lease == nil {
            lease = client.acquireSubscription(
                start: "drawing.open", stop: "drawing.close", payload: target, stopPayload: target)
        }
        if subscription == nil {
            subscription = client.subscribe("drawing.changed") { [weak self] event in
                guard let self, event["projectId"] == self.target["projectId"],
                    event["viewId"] == self.target["viewId"],
                    let document = event["document"]
                else { return }
                self.receive(document)
            }
            connection = client.observeConnection { [weak self] connected in
                guard connected else { return }
                Task { await self?.reload() }
            }
        }
        await reload()
    }

    func stop() {
        lifecycle += 1
        subscription?()
        subscription = nil
        connection?()
        connection = nil
        save()
        let releasing = lease
        lease = nil
        let pending = saveTask
        Task {
            await pending?.value
            await releasing?.release()
        }
    }

    func reload() async {
        let revision = lifecycle
        do {
            let result: JSONValue
            if let lease {
                result = try await lease.refresh()
            } else {
                result = try await client.request("drawing.open", payload: target)
            }
            guard revision == lifecycle else { return }
            guard let document = result["document"] else { throw MachineClientError.invalid("The drawing is missing.") }
            receive(document)
        } catch is CancellationError {
        } catch {
            if revision == lifecycle { problem = error.localizedDescription }
        }
    }

    private func receive(_ remote: JSONValue) {
        guard remote.number("rev") >= (base?.number("rev") ?? 0) else { return }
        do {
            let merged = try Self.merge(base: base, local: document, remote: remote, inFlightElements: inFlightElements)
            let remoteElements = remote.list("elements")
            let competingEdit =
                base != nil && remoteElements != base?.list("elements") && remoteElements != document?.list("elements")
                && remoteElements != inFlightElements
            base = remote
            document = merged
            if competingEdit {
                history.removeAll()
                future.removeAll()
            }
            selection.formIntersection(Set(elements.map(\.stableID)))
            problem = nil
            persist()
            render()
            save()
        } catch {
            problem = "This drawing also changed on another device. Your unsaved drawing is kept on this device."
        }
    }

    static func merge(base: JSONValue?, local: JSONValue?, remote: JSONValue, inFlightElements: [JSONValue]? = nil)
        throws -> JSONValue
    {
        guard let base, let local else { return remote }
        if remote.list("elements") == inFlightElements { return local.setting("rev", remote["rev"]) }
        return try MobileProjectMerge.merge(base: base, local: local, remote: remote) ?? remote
    }

    var selected: [JSONValue] { elements.filter { selection.contains($0.stableID) } }
    var exportElements: [JSONValue] { selection.isEmpty ? elements : selected }
    func select(_ ids: Set<String>) {
        selection = ids
        if let first = selected.first { style.adopt(first) }
    }
    func append(_ element: JSONValue) {
        replace(elements + [element])
        selection = [element.stableID]
        if !toolLocked && ![.pen, .eraser, .pan].contains(tool) { tool = .select }
    }
    @discardableResult func commitGesture(before: [JSONValue], after: [JSONValue]) -> Bool {
        do {
            let merged = try MobileProjectMerge.merge(
                base: .array(before), local: .array(after), remote: .array(elements), path: "drawing.elements")
            replace(merged?.arrayValue ?? elements)
            return true
        } catch {
            problem =
                "An object changed on another device during this gesture. Its latest version is kept. Try the edit again."
            return false
        }
    }
    func updateStyle(_ keys: Set<String>) {
        replace(
            elements.map {
                selection.contains($0.stableID) && $0["locked"] != .bool(true) ? style.apply(to: $0, keys: keys) : $0
            })
    }
    func updateText(_ element: JSONValue, text: String, isNew: Bool) {
        if !isNew, elements.first(where: { $0.stableID == element.stableID }) != element {
            problem = "This text changed on another device. Reopen it to edit the latest version."
            return
        }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && element.text("kind") == "text" {
            if !isNew { replace(elements.filter { $0.stableID != element.stableID }) }
            return
        }
        var written = element.setting("text", .string(text))
        if element.text("kind") == "text", element["sized"] != .bool(true) {
            let size = element.number("size", fallback: 20)
            let font = DrawingPalette.font(element.text("font"), size: size)
            let rect = (text as NSString).boundingRect(
                with: CGSize(width: max(240, element.number("w")), height: 100_000),
                options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil)
            written = written.setting("w", .number(ceil(max(20, rect.width)))).setting(
                "h", .number(ceil(max(size * 1.25, rect.height))))
        }
        if isNew { append(written) } else { replace(elements.map { $0.stableID == written.stableID ? written : $0 }) }
    }
    func deleteSelected() {
        replace(elements.filter { !selection.contains($0.stableID) || $0["locked"] == .bool(true) })
        selection = []
    }
    func duplicate() { insertCopies(selected, at: nil) }
    func insertCopies(_ items: [JSONValue], at center: CGPoint?) {
        guard !items.isEmpty else { return }
        let bounds = DrawingGeometry.bounds(items) ?? .zero
        let delta = center.map { CGPoint(x: $0.x - bounds.midX, y: $0.y - bounds.midY) } ?? CGPoint(x: 24, y: 24)
        let copies = items.map {
            DrawingGeometry.moved($0, by: delta).setting("id", .string(UUID().uuidString)).setting(
                "seed", .number(Double(UInt32.random(in: 0...UInt32.max))))
        }
        replace(elements + copies)
        select(Set(copies.map(\.stableID)))
        tool = .select
    }
    func copySelection(cut: Bool = false) {
        guard !selected.isEmpty,
            let data = try? JSONValue.object([
                "type": .string("application/x-ruimte-drawing"), "elements": .array(selected),
            ]).encoded()
        else { return }
        UIPasteboard.general.string = String(decoding: data, as: UTF8.self)
        if cut { deleteSelected() }
    }
    func paste() {
        guard let text = UIPasteboard.general.string, text.utf8.count <= 8 * 1024 * 1024,
            let json = try? JSONValue.decode(Data(text.utf8)), json.text("type") == "application/x-ruimte-drawing"
        else { return }
        do {
            _ = try WireRequest.drawingSave.validatePayload(
                target.setting("baseRev", .number(0)).setting(
                    "content", .object(["elements": .array(json.list("elements"))])))
            insertCopies(json.list("elements"), at: viewportCenter)
        } catch { problem = "The clipboard does not contain a valid Ruimte drawing." }
    }
    func reorder(front: Bool) {
        let moving = selected.filter { $0["locked"] != .bool(true) }
        let ids = Set(moving.map(\.stableID))
        let staying = elements.filter { !ids.contains($0.stableID) }
        replace(front ? staying + moving : moving + staying)
    }
    func lockSelection() {
        let locking = selected.contains { $0["locked"] != .bool(true) }
        replace(
            elements.map { selection.contains($0.stableID) ? $0.setting("locked", locking ? .bool(true) : nil) : $0 })
        if locking { selection = [] }
    }
    func unlockAll() { replace(elements.map { $0.setting("locked", nil) }) }
    func moveSelection(_ delta: CGPoint) {
        replace(
            elements.map {
                selection.contains($0.stableID) && $0["locked"] != .bool(true)
                    ? DrawingGeometry.moved($0, by: delta) : $0
            })
    }
    func setArrow(_ key: String, value: Bool) {
        replace(
            elements.map {
                selection.contains($0.stableID) && $0.text("kind") == "line" && $0["locked"] != .bool(true)
                    ? $0.setting(key, .bool(value)) : $0
            })
    }
    func erase(_ id: String) { replace(elements.filter { $0.stableID != id || $0["locked"] == .bool(true) }) }
    private func replace(_ elements: [JSONValue]) {
        guard let document, elements != self.elements else { return }
        history.append(self.elements)
        future.removeAll()
        if history.count > 50 { history.removeFirst() }
        self.document = document.setting("elements", .array(elements))
        persist()
        render()
        save()
    }

    func undo() {
        guard let previous = history.popLast(), let document else { return }
        future.append(elements)
        selection = []
        self.document = document.setting("elements", .array(previous))
        persist()
        render()
        save()
    }

    func redo() {
        guard let next = future.popLast(), let document else { return }
        history.append(elements)
        selection = []
        self.document = document.setting("elements", .array(next))
        persist()
        render()
        save()
    }

    func discardDraft() {
        document = base
        history.removeAll()
        future.removeAll()
        selection = []
        problem = nil
        persist()
        render()
        Task { await reload() }
    }

    private func persist() {
        guard dirty, let base, let document else {
            UserDefaults.standard.removeObject(forKey: draftKey)
            return
        }
        if let data = try? JSONValue.object(["base": base, "document": document]).encoded() {
            UserDefaults.standard.set(data, forKey: draftKey)
        }
    }

    private func render() {
        guard let document else { return }
        generation += 1
        let revision = generation
        renderTask?.cancel()
        renderTask = Task {
            do {
                let scene = try await LocalDocumentRenderer.shared.render(kind: "drawing", document: document)
                guard !Task.isCancelled, revision == generation else { return }
                self.scene = scene
            } catch is CancellationError {
            } catch {
                if !Task.isCancelled, revision == generation { problem = error.localizedDescription }
            }
        }
    }

    func save() {
        guard saveTask == nil, dirty, problem == nil else { return }
        saveTask = Task {
            saving = true
            defer {
                saving = false
                saveTask = nil
            }
            var conflicts = 0
            while dirty, problem == nil, let base, let sent = document {
                inFlightElements = sent.list("elements")
                defer { inFlightElements = nil }
                do {
                    let result = try await client.request(
                        "drawing.save",
                        payload:
                            target
                            .setting("baseRev", base["rev"])
                            .setting("content", .object(["elements": .array(sent.list("elements"))])))
                    let saved = sent.setting("rev", result["rev"])
                    if (self.base?.number("rev") ?? 0) <= saved.number("rev") {
                        self.base = saved
                        document = document?.setting("rev", result["rev"])
                    }
                    persist()
                } catch MachineClientError.server(let code, _) where code == "rev-conflict" {
                    conflicts += 1
                    if conflicts > 2 {
                        problem =
                            "This drawing keeps changing on another device. Your changes are saved locally. Tap Retry to sync."
                        return
                    }
                    await reload()
                    if problem != nil { return }
                } catch {
                    problem =
                        "Your drawing is saved on this device and will sync when the connection returns. "
                        + error.localizedDescription
                    return
                }
            }
        }
    }
}

struct DrawingSample {
    let point: CGPoint
    let pressure: Double
}

enum DrawingStroke {
    static func element(samples: [DrawingSample], color: String, width: Int) -> JSONValue? {
        guard let first = samples.first else { return nil }
        let minX = samples.map(\.point.x).min() ?? first.point.x
        let minY = samples.map(\.point.y).min() ?? first.point.y
        let maxX = samples.map(\.point.x).max() ?? minX
        let maxY = samples.map(\.point.y).max() ?? minY
        return .object([
            "id": .string(UUID().uuidString), "kind": .string("freehand"),
            "x": .number(minX), "y": .number(minY), "w": .number(maxX - minX), "h": .number(maxY - minY),
            "stroke": .string(color), "strokeWidth": .number(Double(width)), "seed": .number(0),
            "roughness": .number(0),
            "points": .array(
                samples.map {
                    .array([
                        .number($0.point.x - minX), .number($0.point.y - minY), .number(min(1, max(0, $0.pressure))),
                    ])
                }),
        ])
    }
}
