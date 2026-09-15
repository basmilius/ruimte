import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

@MainActor @Observable
final class MobileWorkspace {
    let session: SharedMachineSession
    let projectID: String
    private(set) var document = JSONValue.object([:])
    private(set) var summary = JSONValue.object([:])
    private(set) var local = JSONValue.object(["activeViewId": .null, "views": .object([:])])
    private(set) var ready = false
    private(set) var saving = false
    var problem: String?
    var conflict: JSONValue?
    var notice: JSONValue?
    var selectedID: String?
    private var base = JSONValue.object([:])
    private var subscriptions: [() -> Void] = []
    private var revision = 0
    private var stopped = true
    private var pendingSave = false
    private var openTask: Task<Void, Never>?
    private var localTask: Task<Void, Never>?
    var views: [JSONValue] { document.list("views") }
    var folder: String { summary.text("folder", fallback: "~") }
    var title: String { document.text("name", fallback: summary.text("name", fallback: "Project")) }
    var client: any MachineRequesting { session.rpc }
    var storageKey: String { "ruimte.ios.workspace.\(session.machine.id).\(projectID)" }

    init(session: SharedMachineSession, projectID: String) {
        self.session = session
        self.projectID = projectID
    }

    isolated deinit { stop() }

    func start() {
        guard stopped else { return }
        stopped = false
        session.retain()
        session.retainProject(projectID)
        subscriptions.append(
            client.subscribe("project.changed") { [weak self] event in
                guard let self, event.text("projectId") == projectID, let incoming = event["document"] else { return }
                receive(incoming)
            })
        subscriptions.append(
            client.subscribe("project.showView") { [weak self] event in
                guard let self, event.text("projectId") == projectID else { return }
                notice = event
            })
        subscriptions.append(
            client.observeConnection { [weak self] connected in
                guard let self else { return }
                if connected {
                    openTask?.cancel()
                    openTask = Task { await self.open() }
                }
            })
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        openTask?.cancel()
        localTask?.cancel()
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
        Task { [projectID, session] in
            await session.releaseProject(projectID)
            session.release()
        }
    }

    func open() async {
        do {
            let result = try await session.openProject(projectID)
            guard !stopped, !Task.isCancelled, let incoming = result["document"] else { return }
            summary = result["summary"] ?? .object([:])
            if ready {
                receive(incoming)
            } else {
                document = incoming
                base = incoming
                revision = Int(incoming.number("rev"))
                local =
                    (UserDefaults.standard.data(forKey: storageKey).flatMap { try? JSONValue.decode($0) }) ?? result[
                        "local"] ?? local
                selectedID =
                    local["activeViewId"]?.stringValue
                    ?? views.first(where: { $0.text("kind") != "separator" })?.stableID
                ready = true
                reconcileSelection()
            }
            problem = nil
            if pendingSave && conflict == nil { await save() }
        } catch { if !Task.isCancelled && session.connected { problem = error.localizedDescription } }
    }

    func receive(_ incoming: JSONValue) {
        guard incoming.number("rev") > Double(revision) else { return }
        do {
            document = try MobileProjectMerge.merge(base: base, local: document, remote: incoming) ?? incoming
            base = incoming
            revision = Int(incoming.number("rev"))
            reconcileSelection()
        } catch {
            conflict = incoming
            problem = error.localizedDescription
        }
    }

    func acceptRemote() {
        guard let conflict else { return }
        document = conflict
        base = conflict
        revision = Int(conflict.number("rev"))
        self.conflict = nil
        problem = nil
        pendingSave = false
        reconcileSelection()
    }

    func keepLocal() async {
        guard let conflict else { return }
        base = conflict
        revision = Int(conflict.number("rev"))
        self.conflict = nil
        pendingSave = true
        await save()
    }

    func edit(_ change: (JSONValue) -> JSONValue) async {
        document = change(document)
        reconcileSelection()
        pendingSave = true
        await save()
    }

    func save() async {
        guard !saving, conflict == nil, session.connected else { return }
        saving = true
        defer { saving = false }
        while pendingSave && conflict == nil && session.connected {
            pendingSave = false
            let sent = document
            let content = sent.setting("rev", nil).setting("version", nil)
            do {
                let result = try await client.request(
                    "project.save",
                    payload: .object([
                        "projectId": .string(projectID), "baseRev": .number(Double(revision)), "content": content,
                    ]))
                let writtenRevision = Int(result.number("rev"))
                if writtenRevision >= revision {
                    revision = writtenRevision
                    base = sent.setting("rev", .number(Double(revision)))
                    document = document.setting("rev", .number(Double(revision)))
                }
                problem = nil
            } catch {
                pendingSave = true
                problem = error.localizedDescription
                // Reopen retrieves the conflicting revision without discarding this client's edits.
                if session.connected {
                    if let result = try? await session.openProject(projectID), let incoming = result["document"] {
                        receive(incoming)
                    }
                }
                break
            }
        }
    }

    private func reconcileSelection() {
        guard !views.contains(where: { $0.stableID == selectedID && $0.text("kind") != "separator" }) else { return }
        select(views.first(where: { $0.text("kind") != "separator" })?.stableID)
    }

    func select(_ id: String?) {
        selectedID = id
        local = local.setting("activeViewId", id.map(JSONValue.string) ?? .null)
        persistLocal()
    }

    func camera(for id: String) -> JSONValue? { local["views"]?[id]?["camera"] }
    func setCamera(_ camera: JSONValue, viewID: String) {
        var views = local["views"]?.objectValue ?? [:]
        views[viewID] = .object(["camera": camera, "focusedNodeId": .null])
        local = local.setting("views", .object(views))
        persistLocal()
    }
    private func persistLocal() {
        if let data = try? local.encoded() { UserDefaults.standard.set(data, forKey: storageKey) }
        localTask?.cancel()
        localTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
            guard let self, !stopped else { return }
            _ = try? await client.request(
                "project.save-local", payload: .object(["projectId": .string(projectID), "local": local]))
        }
    }

    func updateView(_ id: String, change: (JSONValue) -> JSONValue) async {
        await edit { $0.setting("views", .array(self.views.map { $0.stableID == id ? change($0) : $0 })) }
    }

    func ensureSession(_ item: JSONValue) async throws {
        let kind = item.text("kind")
        guard kind == "chat" || kind == "terminal" else { return }
        let metadata = item["node"] ?? item
        let cwd = metadata.text("cwd")
        let resolved = cwd.hasPrefix("/") || cwd.hasPrefix("~") ? cwd : (cwd.isEmpty ? folder : folder + "/" + cwd)
        var payload: [String: JSONValue] = [
            kind == "chat" ? "chatId" : "sessionId": .string(item.stableID), "cwd": .string(resolved),
        ]
        if kind == "terminal" {
            payload["cols"] = .number(100)
            payload["rows"] = .number(30)
            if let provider = metadata["provider"] {
                var agent: [String: JSONValue] = ["kind": provider]
                for key in ["resume", "runtimeMode"] { agent[key] = metadata[key] }
                payload["agent"] = .object(agent)
            } else {
                payload["command"] = metadata["command"]
            }
        } else {
            for key in ["provider", "resume", "runtimeMode"] { payload[key] = metadata[key] }
        }
        do {
            _ = try await client.request(kind == "chat" ? "chat.create" : "session.create", payload: .object(payload))
        } catch MachineClientError.server(let code, _) where kind == "terminal" && code == "session-exists" {
            // The existing shell is shared with the desktop and keeps its current dimensions.
        }
    }
}
