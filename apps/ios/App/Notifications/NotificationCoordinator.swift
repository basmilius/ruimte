import ActivityKit
import CryptoKit
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit
@preconcurrency import UserNotifications

@MainActor final class NotificationAppDelegate: NSObject, UIApplicationDelegate {
    static var latestToken: Data?
    static let tokenChanged = Notification.Name("ruimte.push-token")
    static let tokenFailed = Notification.Name("ruimte.push-token-failed")
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Self.latestToken = deviceToken
        NotificationCenter.default.post(name: Self.tokenChanged, object: deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: Self.tokenFailed, object: error.localizedDescription)
    }
}

struct NotificationDestination: Identifiable, Hashable {
    let id = UUID()
    let machineID: String
    let nodeID: String
    let target: String
}

@MainActor @Observable final class NotificationCoordinator: NSObject, UNUserNotificationCenterDelegate {
    private weak var runtime: AppRuntime?
    private let api: PushAPI
    private(set) var enabled = UserDefaults.standard.bool(forKey: "ruimte.push.enabled")
    var approvals = UserDefaults.standard.object(forKey: "ruimte.push.approvals") as? Bool ?? true
    var activities = UserDefaults.standard.object(forKey: "ruimte.push.activities") as? Bool ?? true
    var supportsActivities: Bool { UIDevice.current.userInterfaceIdiom == .phone }
    private var latestChat: (machineID: String, nodeID: String, title: String, info: JSONValue)?
    private var activitySelection = 0
    private var latestActivityTask: Task<Void, Never>?
    var problem: String?
    var busy = false
    var destination: NotificationDestination?
    private var tokenObservers: [NSObjectProtocol] = []
    private var activityTasks: [String: Task<Void, Never>] = [:]
    private var activityDiscoveryTask: Task<Void, Never>?
    private var liveAttentionKeys = Set<String>()
    private var restored = false
    private var revision = 0
    private var follows: [String: [String]] =
        (UserDefaults.standard.dictionary(forKey: "ruimte.push.follows") as? [String: [String]]) ?? [:]
    var machines: [Machine] { runtime?.machines ?? [] }

    init(runtime: AppRuntime) {
        self.runtime = runtime
        api = PushAPI(baseURL: runtime.client.baseURL)
        super.init()
    }
    func restore() async {
        guard !restored else { return }
        restored = true
        UNUserNotificationCenter.current().delegate = self
        let allow = UNNotificationAction(identifier: "ruimte.allow", title: "Allow", options: [.authenticationRequired])
        let deny = UNNotificationAction(identifier: "ruimte.deny", title: "Deny", options: [.authenticationRequired])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: "ruimte.approval", actions: [allow, deny], intentIdentifiers: [])
        ])
        tokenObservers.append(
            NotificationCenter.default.addObserver(
                forName: NotificationAppDelegate.tokenChanged, object: nil, queue: .main
            ) { [weak self] event in
                guard let token = event.object as? Data else { return }
                Task { @MainActor in await self?.register(token) }
            })
        tokenObservers.append(
            NotificationCenter.default.addObserver(
                forName: NotificationAppDelegate.tokenFailed, object: nil, queue: .main
            ) { [weak self] event in
                let message = event.object as? String
                Task { @MainActor in self?.problem = message }
            })
        guard enabled else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
            return
        }
        UIApplication.shared.registerForRemoteNotifications()
        if let token = NotificationAppDelegate.latestToken { await register(token) }
    }
    func enable() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            guard try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            else {
                problem = "Allow notifications for Ruimte in Settings to receive updates."
                return
            }
            _ = try SharedPushStore().key(create: true)
            enabled = true
            UserDefaults.standard.set(true, forKey: "ruimte.push.enabled")
            UIApplication.shared.registerForRemoteNotifications()
            if let token = NotificationAppDelegate.latestToken { await register(token) }
        } catch { problem = error.localizedDescription }
    }
    private func register(_ token: Data) async {
        guard enabled, let runtime else { return }
        let current = revision
        do {
            guard let access = try await runtime.vault?.accessToken() else { return }
            #if DEBUG
                let environment = "sandbox"
            #else
                let environment = "production"
            #endif
            let handle = try await api.register(token: Self.hex(token), environment: environment, accessToken: access)
            guard current == revision, enabled else {
                try? await api.remove(handle: handle, accessToken: access)
                return
            }
            let store = try SharedPushStore()
            _ = try store.key(create: true)
            try store.save(
                PushDeviceContext(
                    handle: handle,
                    machinePublicKeys: Dictionary(uniqueKeysWithValues: runtime.machines.map { ($0.id, $0.publicKey) }))
            )
            await synchronize()
            startActivityObservers()
        } catch { if current == revision { problem = error.localizedDescription } }
    }
    func synchronize() async {
        guard enabled, let runtime else { return }
        problem = nil
        do {
            let store = try SharedPushStore()
            guard var context = try store.context() else { return }
            context.machinePublicKeys = Dictionary(uniqueKeysWithValues: runtime.machines.map { ($0.id, $0.publicKey) })
            try store.save(context)
            for machine in runtime.machines {
                try Task.checkCancellation()
                guard enabled else { return }
                do { try await subscribe(machine, context: context) } catch {
                    problem = "\(machine.name): \(error.localizedDescription)"
                }
            }
        } catch { problem = error.localizedDescription }
    }
    private func subscribe(_ machine: Machine, context: PushDeviceContext) async throws {
        guard let runtime else { return }
        let current = revision
        let session = runtime.session(for: machine)
        session.retain()
        defer { session.release() }
        try await waitForConnection(session)
        guard enabled, revision == current, try SharedPushStore().context()?.handle == context.handle else { return }
        let key = try SharedPushStore().key()
        _ = try await session.rpc.request(
            "push.subscribe",
            payload: .object([
                "handle": .string(context.handle), "publicKey": .string(key.publicKey),
                "follow": .array((follows[machine.id] ?? []).map(JSONValue.string)), "approvals": .bool(approvals),
                "activities": .bool(activities && supportsActivities),
            ]))
    }
    func disable() async {
        revision += 1
        activitySelection += 1
        latestActivityTask?.cancel()
        latestChat = nil
        enabled = false
        UserDefaults.standard.set(false, forKey: "ruimte.push.enabled")
        activityDiscoveryTask?.cancel()
        activityDiscoveryTask = nil
        activityTasks.values.forEach { $0.cancel() }
        activityTasks.removeAll()
        for activity in Activity<RuimteActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        do {
            let store = try SharedPushStore()
            let context = try store.context()
            if let context, let runtime {
                for machine in runtime.machines {
                    let session = runtime.session(for: machine)
                    if session.connected {
                        Task {
                            _ = try? await session.rpc.request(
                                "push.unsubscribe", payload: .object(["handle": .string(context.handle)]))
                        }
                    }
                }
            }
            // Clear device secrets even when the address book cannot be reached.
            try store.clear()
            if let context, let access = try await runtime?.vault?.accessToken() {
                try await api.remove(handle: context.handle, accessToken: access)
            }
        } catch { problem = error.localizedDescription }
        UIApplication.shared.unregisterForRemoteNotifications()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    }
    func savePreferences() async {
        UserDefaults.standard.set(approvals, forKey: "ruimte.push.approvals")
        UserDefaults.standard.set(activities, forKey: "ruimte.push.activities")
        if activities && supportsActivities {
            startActivityObservers()
            if let latestChat {
                viewedChat(
                    machineID: latestChat.machineID, nodeID: latestChat.nodeID, title: latestChat.title,
                    info: latestChat.info)
            }
        } else {
            activitySelection += 1
            latestActivityTask?.cancel()
            activityDiscoveryTask?.cancel()
            activityDiscoveryTask = nil
            activityTasks.values.forEach { $0.cancel() }
            activityTasks.removeAll()
            for activity in Activity<RuimteActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            if let context = try? SharedPushStore().context(), let access = try? await runtime?.vault?.accessToken() {
                try? await api.startActivity(handle: context.handle, token: nil, accessToken: access)
            }
        }
        await synchronize()
    }
    func follows(machineID: String, nodeID: String) -> Bool { follows[machineID]?.contains(nodeID) == true }
    func follow(machineID: String, nodeID: String, enabled: Bool) async {
        var values = Set(follows[machineID] ?? [])
        if enabled {
            guard values.contains(nodeID) || values.count < 500 else {
                problem = "You can follow at most 500 sessions on one machine."
                return
            }
            values.insert(nodeID)
        } else {
            values.remove(nodeID)
        }
        follows[machineID] = Array(values).sorted()
        UserDefaults.standard.set(follows, forKey: "ruimte.push.follows")
        await synchronize()
    }
    func availableSessions(_ machine: Machine) async throws -> [JSONValue] {
        guard let runtime else { return [] }
        let session = runtime.session(for: machine)
        session.retain()
        defer { session.release() }
        try await waitForConnection(session)
        let terminals = try await session.rpc.request("session.list").list("sessions").filter {
            $0["exited"] != .bool(true)
        }.map {
            $0.setting("id", $0["sessionId"]).setting("title", .string($0["agent"]?.text("kind") ?? "Terminal"))
                .setting("target", .string("terminal"))
        }
        let chats = try await session.rpc.request("chat.list").list("chats").map {
            $0.setting("id", $0["chatId"] ?? $0["id"]).setting("target", .string("chat")).setting(
                "title", .string($0.text("suggestedTitle", fallback: "Chat")))
        }
        return terminals + chats
    }
    func viewedChat(machineID: String, nodeID: String, title: String, info: JSONValue) {
        guard supportsActivities, info != .null else { return }
        latestChat = (machineID, nodeID, title, info)
        guard activities, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        activitySelection += 1
        let selection = activitySelection
        latestActivityTask?.cancel()
        latestActivityTask = Task { [weak self] in
            guard let self else { return }
            let collapse = Self.collapseID(machineID: machineID, nodeID: nodeID)
            for activity in Activity<RuimteActivityAttributes>.activities
            where activity.attributes.machineId != machineID || activity.attributes.collapseId != collapse {
                activityTasks.removeValue(forKey: activity.id)?.cancel()
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            guard selection == activitySelection, !Task.isCancelled, activities else { return }
            let phase: PushActivityContentPhase =
                info.text("status") == "needs-you"
                ? .needsYou
                : info["running"] == .bool(true) ? .running : .done
            let existing = Activity<RuimteActivityAttributes>.activities.first {
                $0.attributes.machineId == machineID && $0.attributes.collapseId == collapse
            }
            let content = PushActivityContent(
                title: String(decoding: title.utf16.prefix(159), as: UTF16.self), phase: phase,
                startedAt: existing?.content.state.startedAt ?? Int64(Date().timeIntervalSince1970 * 1000))
            let value = ActivityContent(state: content, staleDate: Date().addingTimeInterval(900))
            do {
                if let existing {
                    if existing.content.state != content { await Self.updateActivity(id: existing.id, state: content) }
                } else {
                    guard UIApplication.shared.applicationState == .active else { return }
                    let activity = try Activity.request(
                        attributes: RuimteActivityAttributes(machineId: machineID, collapseId: collapse),
                        content: value, pushType: .token)
                    if enabled { observe(activity) }
                }
                // Remember routing even if notifications are disabled; local Live Activities need no alert permission.
                if !follows(machineID: machineID, nodeID: nodeID) {
                    var followed = follows[machineID] ?? []
                    if followed.count >= 500 { followed.removeFirst() }
                    followed.append(nodeID)
                    follows[machineID] = followed
                    UserDefaults.standard.set(follows, forKey: "ruimte.push.follows")
                    if enabled { await synchronize() }
                }
            } catch {
                if selection == activitySelection { problem = error.localizedDescription }
            }
        }
    }

    private nonisolated static func updateActivity(id: String, state: PushActivityContent) async {
        guard !Task.isCancelled,
            let activity = Activity<RuimteActivityAttributes>.activities.first(where: { $0.id == id })
        else { return }
        await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(900)))
    }

    private func startActivityObservers() {
        guard enabled, activities, supportsActivities else { return }
        for activity in Activity<RuimteActivityAttributes>.activities { observe(activity) }
        if activityDiscoveryTask == nil {
            activityDiscoveryTask = Task { [weak self] in
                for await activity in Activity<RuimteActivityAttributes>.activityUpdates {
                    guard !Task.isCancelled else { break }
                    self?.observe(activity)
                }
            }
        }
        if let context = try? SharedPushStore().context() {
            Task { [weak self] in
                guard let self, let access = try? await self.runtime?.vault?.accessToken() else { return }
                try? await self.api.startActivity(handle: context.handle, token: nil, accessToken: access)
            }
        }
    }

    private func observe(_ activity: Activity<RuimteActivityAttributes>) {
        guard activityTasks[activity.id] == nil else { return }
        activityTasks[activity.id] = Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                guard let self, !Task.isCancelled, self.enabled, self.activities else { break }
                do {
                    guard let context = try SharedPushStore().context(),
                        let access = try await self.runtime?.vault?.accessToken()
                    else { continue }
                    try await self.api.activity(
                        handle: context.handle, machineID: activity.attributes.machineId,
                        collapseID: activity.attributes.collapseId, token: Self.hex(token), accessToken: access)
                } catch { self.problem = error.localizedDescription }
            }
        }
    }
    func syncBadge(liveKeys: Set<String>) async {
        liveAttentionKeys = liveKeys
        await updateBadge()
    }
    private func updateBadge() async {
        let offline = (try? SharedPushStore().attentionKeys()) ?? []
        try? await UNUserNotificationCenter.current().setBadgeCount(offline.union(liveAttentionKeys).count)
    }
    func markSeen(machineID: String, nodeID: String) async {
        guard let key = try? PushReplayLedger.nodeKey(machineID: machineID, nodeID: nodeID) else { return }
        _ = try? SharedPushStore().clearAttention(node: key)
        let delivered = await UNUserNotificationCenter.current().deliveredNotifications()
        let identifiers = delivered.filter { $0.request.content.userInfo["ruimte.seenKey"] as? String == key }.map {
            $0.request.identifier
        }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: identifiers)
        await updateBadge()
    }
    func openActivityURL(_ url: URL) {
        guard url.scheme == "ruimte", url.host == "activity",
            let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let machine = parts.queryItems?.first(where: { $0.name == "machine" })?.value,
            let collapse = parts.queryItems?.first(where: { $0.name == "collapse" })?.value,
            let node = follows[machine]?.first(where: { Self.collapseID(machineID: machine, nodeID: $0) == collapse })
        else { return }
        destination = NotificationDestination(machineID: machine, nodeID: node, target: "unknown")
    }
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await updateBadge()
        return [.banner, .sound]
    }
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        guard let raw = response.notification.request.content.userInfo["ruimte"],
            let data = try? JSONSerialization.data(withJSONObject: raw)
        else { return }
        await respond(data: data, action: response.actionIdentifier)
    }
    private func respond(data: Data, action: String) async {
        do {
            let envelope = try JSONValue.decode(data)
            let store = try SharedPushStore()
            guard enabled, let context = try store.context() else { throw PushCryptoError.wrongDevice }
            let alert = try store.key().decrypt(
                envelope, handle: context.handle, machinePublicKeys: context.machinePublicKeys,
                allowExpiredRouting: true)
            guard let machineID = envelope["machineId"]?.stringValue else { throw PushCryptoError.invalid }
            guard
                runtime?.machines.contains(where: {
                    $0.id == machineID && $0.publicKey == context.machinePublicKeys[machineID]
                }) == true
            else { throw PushCryptoError.unknownMachine }
            let route = NotificationDestination(
                machineID: machineID, nodeID: alert.nodeId, target: alert.target.rawValue)
            destination = route
            await markSeen(machineID: machineID, nodeID: alert.nodeId)
            if action == "ruimte.allow" || action == "ruimte.deny" {
                guard Double(alert.expiresAt) > Date().timeIntervalSince1970 * 1000 else {
                    throw PushCryptoError.expired
                }
                try await answerInBackground(alert, machineID: machineID, allow: action == "ruimte.allow")
                if destination?.id == route.id { destination = nil }
            }
        } catch { problem = error.localizedDescription }
    }
    private func answerInBackground(_ alert: PushAlertContent, machineID: String, allow: Bool) async throws {
        guard let runtime else { throw MachineClientError.disconnected }
        let sceneID = "push-action-" + UUID().uuidString
        runtime.connections.setScene(sceneID, foreground: true)
        let work = Task { @MainActor in
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask { try await self.answer(alert, machineID: machineID, allow: allow) }
                group.addTask {
                    try await Task.sleep(for: .seconds(25))
                    throw MachineClientError.timeout("approval")
                }
                defer { group.cancelAll() }
                _ = try await group.next()
            }
        }
        let background = UIApplication.shared.beginBackgroundTask(withName: "Ruimte approval") { work.cancel() }
        defer {
            work.cancel()
            runtime.connections.setScene(sceneID, foreground: false)
            if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
        }
        try await work.value
    }

    private func answer(_ alert: PushAlertContent, machineID: String, allow: Bool) async throws {
        guard let runtime, let machine = runtime.machines.first(where: { $0.id == machineID }), alert.requestId != nil,
            alert.kind == .approval
        else { throw PushCryptoError.invalid }
        let session = runtime.session(for: machine)
        session.retain()
        defer { session.release() }
        try await waitForConnection(session)
        guard Double(alert.expiresAt) > Date().timeIntervalSince1970 * 1000 else { throw PushCryptoError.expired }
        if alert.target == .chat {
            let lease = session.rpc.acquireAttachment("chat", id: alert.nodeId)
            do {
                let snapshot = try await lease.snapshot(payload: .object(["chatId": .string(alert.nodeId)]))
                try Task.checkCancellation()
                let payload = try NotificationApproval.chatPayload(alert: alert, snapshot: snapshot, allow: allow)
                _ = try await session.rpc.request("chat.approve", payload: payload)
                await lease.release()
            } catch {
                await lease.release()
                throw error
            }
        } else {
            let snapshot = try await session.rpc.request("session.list")
            let payload = try NotificationApproval.terminalPayload(alert: alert, snapshot: snapshot, allow: allow)
            let result = try await session.rpc.request("agent.answerApproval", payload: payload)
            guard result["accepted"] == .bool(true) else { throw PushCryptoError.expired }
        }
    }
    private func waitForConnection(_ session: SharedMachineSession) async throws {
        if session.connected { return }
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { try await self.connectionBecameReady(session) }
            group.addTask {
                try await Task.sleep(for: .seconds(15))
                throw MachineClientError.timeout("connect")
            }
            defer { group.cancelAll() }
            _ = try await group.next()
        }
    }
    private func connectionBecameReady(_ session: SharedMachineSession) async throws {
        let (stream, continuation) = AsyncStream<Bool>.makeStream()
        let stop = session.rpc.observeConnection { continuation.yield($0) }
        defer {
            stop()
            continuation.finish()
        }
        for await connected in stream { if connected { return } }
        throw CancellationError()
    }
    private static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
    private static func collapseID(machineID: String, nodeID: String) -> String {
        let bytes = try! JSONValue.array([.string(machineID), .string(nodeID)]).encoded()
        return Base64URL.encode(Data(SHA256.hash(data: bytes)))
    }
}
