import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

@MainActor @Observable
final class MobileWorkspace {
    typealias Schedule = @MainActor (Duration, @escaping @MainActor () async -> Void) -> Task<Void, Never>

    let session: SharedMachineSession
    let projectID: String
    private let schedule: Schedule
    /// The document as it is merged and saved. The generated types read it for the screens and never write it back.
    private(set) var document = JSONValue.object([:]) { didSet { readDocument() } }
    private(set) var header: StoredDocument?
    private(set) var storedViews: [StoredView] = []
    private(set) var summary = JSONValue.object([:])
    private(set) var local = JSONValue.object(["activeViewId": .null, "views": .object([:])])
    private(set) var ready = false
    private(set) var saving = false
    var problem: String?
    var conflict: JSONValue?
    var notice: ProjectShowViewEvent?
    var selectedID: String?
    /// Per node, the project-file command its terminal started without, until a person approves it.
    private(set) var heldCommands: [String: String] = [:]
    private var base = JSONValue.object([:])
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.projectChanged, as: ProjectChangedEvent.self) { [weak self] event in
                guard let self, event.projectId == projectID else { return }
                receive(event.document)
            },
            .apply(.projectShowView, as: ProjectShowViewEvent.self) { [weak self] event in
                guard let self, event.projectId == projectID else { return }
                notice = event
            },
            .apply(.sessionListChanged, raw: { [weak self] _ in
                guard let self, !heldCommands.isEmpty else { return }
                Task { await self.refreshHeldCommands() }
            }),
        ],
        read: { [weak self] in await self?.open() })
    private var revision = 0
    private var stopped = true
    private var pendingSave = false
    private var localTask: Task<Void, Never>?
    @ObservationIgnored private var cameraTask: Task<Void, Never>?
    @ObservationIgnored private var pendingCameras: [String: JSONValue] = [:]
    var views: [JSONValue] { document.list("views") }
    /// A view by id, read through the generated types.
    func storedView(_ id: String) -> StoredView? { storedViews.first { $0.id == id } }
    /// A view by id; an empty object when it is gone, so a page that outlives its view reads nothing.
    func view(_ id: String) -> JSONValue { views.first { $0.stableID == id } ?? .object([:]) }
    var folder: String { summary.text("folder", fallback: "~") }
    var title: String {
        header?.name ?? summary.text("name", fallback: String(localized: "Project"))
    }
    /// The machine's Chats project, which holds the chats outside any project; its folder is the machine's own.
    var isScratch: Bool { summary["scratch"]?.boolValue == true }
    var client: any MachineRequesting { session.rpc }
    /// What a person calls each view and node, by id, for a list that names sessions by their node.
    var nodeTitles: [String: String] {
        var titles: [String: String] = [:]
        for view in storedViews {
            titles[view.id] = view.name
            for node in view.nodes { titles[node.id] = node.title }
        }
        return titles
    }
    var storageKey: String { "ruimte.ios.workspace.\(session.machine.id).\(projectID)" }

    /// `summary` is the project's row where it was picked, so its page has its title and kind before it opens.
    init(
        session: SharedMachineSession, projectID: String, summary: JSONValue = .object([:]),
        schedule: @escaping Schedule = { delay, action in
            Task {
                do { try await Task.sleep(for: delay) } catch { return }
                guard !Task.isCancelled else { return }
                await action()
            }
        }
    ) {
        self.session = session
        self.projectID = projectID
        self.summary = summary
        self.schedule = schedule
    }

    isolated deinit { stop() }

    func start() {
        guard stopped else { return }
        stopped = false
        session.retain()
        session.retainProject(projectID)
        session.tasks.watch(projectID)
        live.start()
    }

    func stop() {
        flushCameras()
        guard !stopped else { return }
        stopped = true
        live.stop()
        localTask?.cancel()
        session.tasks.unwatch(projectID)
        Task { [projectID, session] in
            await session.releaseProject(projectID)
            session.release()
        }
    }

    func open() async {
        do {
            let result = try await session.openProject(projectID).decoded(as: ProjectOpenResult.self)
            guard !stopped, !Task.isCancelled else { return }
            let incoming = result.document
            summary = result.summary
            if ready {
                receive(incoming)
            } else {
                document = incoming
                base = incoming
                revision = Self.revision(of: incoming)
                local =
                    (UserDefaults.standard.data(forKey: storageKey).flatMap { try? JSONValue.decode($0) })
                    ?? result.local
                selectedID =
                    local["activeViewId"]?.stringValue
                    ?? views.first(where: { !WorkspaceViewSections.isDivider($0) })?.stableID
                ready = true
                reconcileSelection()
            }
            problem = nil
            if pendingSave && conflict == nil { await save() }
        } catch { if !Task.isCancelled && session.connected { problem = error.localizedDescription } }
    }

    /// The revision a document carries; zero for one that does not read, which no revision replaces.
    private static func revision(of document: JSONValue) -> Int {
        (try? document.decoded(as: StoredDocument.self)).map { Int($0.rev) } ?? 0
    }

    private func readDocument() {
        header = try? document.decoded(as: StoredDocument.self)
        storedViews = views.storedViews
    }

    func receive(_ incoming: JSONValue) {
        guard Self.revision(of: incoming) > revision else { return }
        do {
            document = try MobileProjectMerge.merge(base: base, local: document, remote: incoming) ?? incoming
            base = incoming
            revision = Self.revision(of: incoming)
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
        revision = Self.revision(of: conflict)
        self.conflict = nil
        problem = nil
        pendingSave = false
        reconcileSelection()
    }

    func keepLocal() async {
        guard let conflict else { return }
        base = conflict
        revision = Self.revision(of: conflict)
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
        guard !saving, conflict == nil, session.rpc.isConnected else { return }
        saving = true
        defer { saving = false }
        var rev = RevSave()
        while pendingSave && conflict == nil && session.rpc.isConnected {
            let outcome = await rev.send(
                { [self] in
                    pendingSave = false
                    let sent = document
                    let content = sent.setting("rev", nil).setting("version", nil)
                    do {
                        let result = try await client.request(
                            .projectSave,
                            payload: .object([
                                "projectId": .string(projectID), "baseRev": .number(Double(revision)),
                                "content": content,
                            ]))
                        return (sent, Int(try result.decoded(as: ProjectSaveResult.self).rev))
                    } catch {
                        pendingSave = true
                        problem = error.localizedDescription
                        throw error
                    }
                },
                reload: { [self] in await mergeNewerRevision() })
            guard case .saved(let (sent, writtenRevision)) = outcome else { break }
            if writtenRevision >= revision {
                revision = writtenRevision
                base = sent.setting("rev", .number(Double(revision)))
                document = document.setting("rev", .number(Double(revision)))
            }
            problem = nil
        }
    }

    /// Reopen retrieves the conflicting revision without discarding this client's edits. True when they merged onto
    /// a newer revision, so the edit can go out again.
    private func mergeNewerRevision() async -> Bool {
        guard session.rpc.isConnected else { return false }
        let failedRevision = revision
        guard let result = try? await session.openProject(projectID).decoded(as: ProjectOpenResult.self) else {
            return false
        }
        receive(result.document)
        return revision > failedRevision && conflict == nil
    }

    private func reconcileSelection() {
        guard !views.contains(where: { $0.stableID == selectedID && !WorkspaceViewSections.isDivider($0) }) else {
            return
        }
        select(views.first(where: { !WorkspaceViewSections.isDivider($0) })?.stableID)
    }

    func select(_ id: String?) {
        selectedID = id
        local = local.setting("activeViewId", id.map(JSONValue.string) ?? .null)
        persistLocal()
    }

    func camera(for id: String) -> JSONValue? { pendingCameras[id] ?? local["views"]?[id]?["camera"] }
    func setCamera(_ camera: JSONValue, viewID: String) {
        guard self.camera(for: viewID) != camera else { return }
        pendingCameras[viewID] = camera
        guard cameraTask == nil else { return }
        cameraTask = schedule(.milliseconds(400)) { [weak self] in
            self?.flushCameras()
        }
    }
    func flushCameras() {
        guard !pendingCameras.isEmpty else { return }
        persistLocal()
    }
    func locks(for id: String) -> CanvasLocks { CanvasLocks(local["views"]?[id]?["locks"]) }
    func setLocks(_ locks: CanvasLocks, viewID: String) {
        updateLocalView(viewID) { $0.setting("locks", locks.json) }
    }
    private func updateLocalView(_ id: String, change: (JSONValue) -> JSONValue) {
        var views = local["views"]?.objectValue ?? [:]
        views[id] = change(localView(id))
        local = local.setting("views", .object(views))
        persistLocal()
    }
    private func localView(_ id: String) -> JSONValue {
        let current = local["views"]?[id] ?? .object(["camera": .null, "focusedNodeId": .null])
        return current.setting("focusedNodeId", current["focusedNodeId"] ?? .null)
    }
    private func persistLocal() {
        cameraTask?.cancel()
        cameraTask = nil
        if !pendingCameras.isEmpty {
            var views = local["views"]?.objectValue ?? [:]
            for (id, camera) in pendingCameras { views[id] = localView(id).setting("camera", camera) }
            pendingCameras.removeAll(keepingCapacity: true)
            local = local.setting("views", .object(views))
        }
        if let data = try? local.encoded() { UserDefaults.standard.set(data, forKey: storageKey) }
        localTask?.cancel()
        localTask = schedule(.milliseconds(400)) { [weak self] in
            guard let self, !stopped else { return }
            _ = try? await client.request(
                .projectSaveLocal, payload: .object(["projectId": .string(projectID), "local": local]))
        }
    }

    func updateView(_ id: String, change: (JSONValue) -> JSONValue) async {
        await edit { $0.setting("views", .array(self.views.map { $0.stableID == id ? change($0) : $0 })) }
    }

    /// A view, or a node on any canvas, by id.
    func item(_ id: String) -> JSONValue? {
        views.first { $0.stableID == id } ?? views.lazy.flatMap { $0.list("nodes") }.first { $0.stableID == id }
    }

    /// Waits for an item the machine wrote to reach this copy of the project. An item that never comes is the case
    /// the five seconds are for.
    func arrival(of id: String) async -> Bool {
        await waitUntil(timeout: .seconds(5)) { [self] in item(id) != nil }
    }

    func ensureSession(_ item: JSONValue) async throws {
        let kind = item.text("kind")
        guard kind == "chat" || kind == "terminal" else { return }
        if kind == "chat", session.hasLiveChat(item.stableID) { return }
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
            for key in ["provider", "account", "resume", "runtimeMode"] { payload[key] = metadata[key] }
        }
        do {
            let info = try await client.request(
                kind == "chat" ? .chatCreate : .sessionCreate, payload: .object(payload))
            if kind == "terminal" { heldCommands[item.stableID] = info["heldCommand"]?.stringValue }
        } catch let error as MachineClientError where kind == "terminal" && error.code == .sessionExists {
            // The existing shell is shared with the desktop and keeps its current dimensions.
            await refreshHeldCommands(including: item.stableID)
        }
    }

    /// Approves the command the machine holds for this terminal. The machine records the approval and types it.
    func runHeldCommand(_ id: String) async {
        do {
            _ = try await client.request(.sessionRunHeld, payload: .object(["sessionId": .string(id)]))
            heldCommands[id] = nil
        } catch { problem = error.localizedDescription }
    }

    /// Another client may have approved a command, or a shell started elsewhere may hold one. Only the session list
    /// knows.
    private func refreshHeldCommands(including id: String? = nil) async {
        guard let result = try? await client.request(.sessionList) else { return }
        let held = Dictionary(
            result.list("sessions").compactMap { session in
                session["heldCommand"]?.stringValue.map { (session.text("sessionId"), $0) }
            }, uniquingKeysWith: { first, _ in first })
        for key in Set(heldCommands.keys).union(id.map { [$0] } ?? []) { heldCommands[key] = held[key] }
    }
}
