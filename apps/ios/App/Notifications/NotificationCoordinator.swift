import ActivityKit
import CryptoKit
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit
@preconcurrency import UserNotifications

@MainActor final class NotificationAppDelegate: NSObject, UIApplicationDelegate {
    static let runtime = AppRuntime()
    static var latestToken: Data?
    private static let delivery = NotificationDeliveryBridge()
    private static weak var coordinator: NotificationCoordinator?
    private static var pendingResponses: [(Data, String)] = []

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = Self.delivery
        let background = NotificationBackgroundLease(name: "Restore notification delivery")
        Task { @MainActor in
            defer { background.end() }
            // Push-to-start wakes the application without creating a SwiftUI screen.
            await Self.runtime.start()
            await Self.runtime.notifications.restore()
        }
        return true
    }

    func application(
        _ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        let data = userInfo["ruimte"].flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        Task { @MainActor in
            guard let data else {
                completionHandler(.noData)
                return
            }
            do {
                let envelope = try JSONValue.decode(data)
                guard envelope["pushType"] == .string("background") else {
                    completionHandler(.noData)
                    return
                }
                let store = try SharedPushStore()
                guard let context = try store.context() else { throw PushCryptoError.wrongDevice }
                let content = try store.key().decryptRead(
                    envelope, handle: context.handle, machinePublicKeys: context.machinePublicKeys)
                guard let machineID = envelope["machineId"]?.stringValue,
                    let id = envelope["id"]?.stringValue, let expires = envelope["expiresAt"]?.numberValue
                else {
                    throw PushCryptoError.invalid
                }
                let receipt = try PushReplayLedger.nodeKey(machineID: machineID, nodeID: id)
                try store.claim(id: receipt, expiresAt: expires, now: Date().timeIntervalSince1970 * 1000)
                try await NotificationReadSync.apply(
                    machineID: machineID, nodeID: content.nodeId, through: Double(content.through))
                await Self.coordinator?.updateBadge()
                completionHandler(.newData)
            } catch { completionHandler(.failed) }
        }
    }

    static func receive(_ data: Data, action: String) async {
        guard let coordinator else {
            pendingResponses.append((data, action))
            return
        }
        await coordinator.respond(data: data, action: action)
    }

    static func attach(_ value: NotificationCoordinator) async {
        coordinator = value
        let pending = pendingResponses
        pendingResponses.removeAll()
        for (data, action) in pending { await value.respond(data: data, action: action) }
    }

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

private final class NotificationDeliveryBridge: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        let info = notification.request.content.userInfo
        let nodeKey = info["ruimte.seenKey"] as? String
        let issuedAt = (info["ruimte.issuedAt"] as? NSNumber)?.doubleValue
        Task { @MainActor in
            if let nodeKey, let issuedAt, let through = try? SharedPushStore().readThrough(node: nodeKey),
                through >= issuedAt
            {
                completionHandler([])
            } else {
                completionHandler([.banner, .sound])
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let data = response.notification.request.content.userInfo["ruimte"].flatMap {
            try? JSONSerialization.data(withJSONObject: $0)
        }
        let action = response.actionIdentifier
        Task { @MainActor in
            // UIKit's notification completion updates scene snapshots and must run on the main thread.
            defer { completionHandler() }
            if let data, action != UNNotificationDismissActionIdentifier {
                await NotificationAppDelegate.receive(data, action: action)
            }
        }
    }
}

struct NotificationDestination: Identifiable, Hashable {
    let id = UUID()
    let machineID: String
    let nodeID: String
    let target: String
}

@MainActor @Observable final class NotificationCoordinator: NSObject {
    private weak var runtime: AppRuntime?
    private let api: PushAPI
    private(set) var enabled = UserDefaults.standard.bool(forKey: "ruimte.push.enabled")
    var approvals = UserDefaults.standard.object(forKey: "ruimte.push.approvals") as? Bool ?? true
    var activities = UserDefaults.standard.object(forKey: "ruimte.push.activities") as? Bool ?? true
    var supportsActivities: Bool { UIDevice.current.userInterfaceIdiom == .phone }
    var problem: String?
    var busy = false
    var destination: NotificationDestination?
    private var tokenObservers: [NSObjectProtocol] = []
    private var activityTasks: [String: Task<Void, Never>] = [:]
    private var activityDiscoveryTask: Task<Void, Never>?
    private var startTokenTask: Task<Void, Never>?
    private var activityRegistrationTask: Task<Void, Never>?
    @ObservationIgnored private var preferenceSaveTask: Task<Void, Never>?
    @ObservationIgnored private var preferenceObservation: ObservationTracking.Token?
    private var startToken: Data?
    private var activityStateTasks: [String: Task<Void, Never>] = [:]
    private var liveAttentionKeys = Set<String>()
    private var retiredHandles: [String] {
        get { UserDefaults.standard.stringArray(forKey: "ruimte.push.retired-handles") ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: "ruimte.push.retired-handles") }
    }
    private var restored = false
    private var revision = 0
    private var follows: [String: [String]] =
        (UserDefaults.standard.dictionary(forKey: "ruimte.push.follows") as? [String: [String]]) ?? [:]
    var machines: [Machine] { runtime?.machines ?? [] }

    init(runtime: AppRuntime) {
        self.runtime = runtime
        api = PushAPI(baseURL: runtime.client.baseURL)
        super.init()
        observePreferences()
    }

    private func observePreferences() {
        preferenceObservation = withContinuousObservation(options: .didSet) { [weak self] event in
            guard let self else { return }
            _ = self.approvals
            _ = self.activities
            guard event.kind == .didSet else { return }
            self.preferenceSaveTask?.cancel()
            self.preferenceSaveTask = Task { [weak self] in
                await Task.yield()
                guard !Task.isCancelled else { return }
                await self?.savePreferences()
            }
        }
    }

    func restore() async {
        guard !restored else { return }
        restored = true
        await NotificationAppDelegate.attach(self)
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
        do { try await removeRetiredDevices() } catch { problem = error.localizedDescription }
        guard enabled else { return }
        startActivityObservers()
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
            try await removeRetiredDevices()
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
            await synchronizeActivityTarget()
            startActivityObservers()
            await synchronize()
        } catch { if current == revision { problem = error.localizedDescription } }
    }
    private func removeRetiredDevices() async throws {
        guard !retiredHandles.isEmpty, let access = try await runtime?.vault?.accessToken() else { return }
        for handle in retiredHandles {
            do { try await api.remove(handle: handle, accessToken: access) } catch let error as AddressBookRequestError
                where error.status == 404
            {}
            retiredHandles.removeAll { $0 == handle }
        }
    }

    func synchronize() async {
        do { try await removeRetiredDevices() } catch {
            problem = error.localizedDescription
            return
        }
        guard enabled, let runtime else { return }
        problem = nil
        do {
            let store = try SharedPushStore()
            guard var context = try store.context() else {
                if let token = NotificationAppDelegate.latestToken {
                    await register(token)
                } else {
                    UIApplication.shared.registerForRemoteNotifications()
                }
                return
            }
            context.machinePublicKeys = Dictionary(uniqueKeysWithValues: runtime.machines.map { ($0.id, $0.publicKey) })
            try store.save(context)
            for machine in runtime.machines {
                try Task.checkCancellation()
                guard enabled else { return }
                do { try await subscribe(machine, context: context) } catch {
                    problem = "\(machine.name): \(error.localizedDescription)"
                }
            }
            await synchronizeActivityTarget()
        } catch { problem = error.localizedDescription }
    }
    private func subscribe(_ machine: Machine, context: PushDeviceContext) async throws {
        guard let runtime else { return }
        let current = revision
        let session = runtime.session(for: machine)
        session.retain()
        defer { session.release() }
        try await session.waitForConnection()
        guard enabled, revision == current, try SharedPushStore().context()?.handle == context.handle else { return }
        let key = try SharedPushStore().key()
        // Older daemons ignore followAll, so keep their known sessions subscribed during an upgrade.
        let terminals = try await session.rpc.request("session.list").list("sessions")
        let chats = try await session.rpc.request("chat.list").list("chats")
        let known = Set(terminals.map { $0.text("sessionId") } + chats.map { $0.text("chatId", fallback: $0.stableID) })
            .filter { !$0.isEmpty }.sorted().prefix(500)
        _ = try await session.rpc.request(
            "push.subscribe",
            payload: .object([
                "handle": .string(context.handle), "publicKey": .string(key.publicKey),
                "follow": .array(known.map(JSONValue.string)), "followAll": .bool(true), "approvals": .bool(approvals),
                "readSync": .bool(true),
                "activities": .bool(activities && supportsActivities),
                "activityScope": .string("machine"),
            ]))
    }
    func disable() async {
        revision += 1
        UserDefaults.standard.removeObject(forKey: "ruimte.push.activity-target")
        enabled = false
        UserDefaults.standard.set(false, forKey: "ruimte.push.enabled")
        startTokenTask?.cancel()
        startTokenTask = nil
        activityStateTasks.values.forEach { $0.cancel() }
        activityStateTasks.removeAll()
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
            if let context { retiredHandles = Array(Set(retiredHandles + [context.handle])) }
            // Keep the opaque revocation handle while discarding decryption secrets immediately.
            try store.clear()
            try await removeRetiredDevices()
        } catch { problem = error.localizedDescription }
        UIApplication.shared.unregisterForRemoteNotifications()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    }
    private func savePreferences() async {
        UserDefaults.standard.set(approvals, forKey: "ruimte.push.approvals")
        UserDefaults.standard.set(activities, forKey: "ruimte.push.activities")
        if activities && supportsActivities {
            startActivityObservers()
        } else {
            startTokenTask?.cancel()
            startTokenTask = nil
            activityDiscoveryTask?.cancel()
            activityDiscoveryTask = nil
            activityTasks.values.forEach { $0.cancel() }
            activityTasks.removeAll()
            await synchronizeActivityTarget()
            for activity in Activity<RuimteActivityAttributes>.activities {
                guard !activities else { break }
                await retire(activity)
            }
        }
        await synchronize()
    }
    func startBackgroundActivityDelivery() { startActivityObservers() }

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
        if startTokenTask == nil {
            startToken = Activity<RuimteActivityAttributes>.pushToStartToken
            startTokenTask = Task { [weak self] in
                for await token in Activity<RuimteActivityAttributes>.pushToStartTokenUpdates {
                    guard let self, !Task.isCancelled, self.enabled, self.activities else { break }
                    self.startToken = token
                    await self.synchronizeActivityTarget()
                }
            }
        }
        Task { await synchronizeActivityTarget() }
    }

    private func synchronizeActivityTarget() async {
        let previous = activityRegistrationTask
        let current = revision
        activityRegistrationTask = Task { [weak self] in
            await previous?.value
            guard let self, current == self.revision, let context = try? SharedPushStore().context() else { return }
            do {
                guard let access = try await self.runtime?.vault?.accessToken() else { return }
                let active =
                    self.enabled && self.activities && self.supportsActivities
                    && ActivityAuthorizationInfo().areActivitiesEnabled
                try await self.api.startActivity(
                    handle: context.handle, token: active ? self.startToken.map(Self.hex) : nil,
                    scope: active ? "machines" : nil, accessToken: access)

            } catch { if current == self.revision { self.problem = error.localizedDescription } }
        }
        await activityRegistrationTask?.value
    }

    private nonisolated static func endActivity(id: String) async {
        guard let activity = Activity<RuimteActivityAttributes>.activities.first(where: { $0.id == id }) else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
    }

    private func retire(
        _ activity: Activity<RuimteActivityAttributes>, release: Bool = true, cancelStateObserver: Bool = true,
        dismiss: Bool = true
    ) async {
        activityTasks.removeValue(forKey: activity.id)?.cancel()
        let stateObserver = activityStateTasks.removeValue(forKey: activity.id)
        // The state observer must finish its token revocation before it exits.
        if cancelStateObserver { stateObserver?.cancel() }
        if dismiss { await Self.endActivity(id: activity.id) }
        if let context = try? SharedPushStore().context(), let access = try? await runtime?.vault?.accessToken() {
            try? await api.activity(
                handle: context.handle, machineID: activity.attributes.machineId,
                collapseID: activity.attributes.collapseId, token: nil, release: release,
                startedAt: activity.content.state.startedAt, accessToken: access)
        }
    }

    private func observe(_ activity: Activity<RuimteActivityAttributes>) {
        guard activityTasks[activity.id] == nil, enabled, activities, supportsActivities,
            activity.activityState == .active || activity.activityState == .stale
        else { return }
        guard knowsMachine(activity.attributes.machineId),
            activity.attributes.collapseId
                == Self.collapseID(machineID: activity.attributes.machineId, nodeID: Self.machineActivityNode),
            !Activity<RuimteActivityAttributes>.activities.contains(where: {
                $0.id != activity.id && activityTasks[$0.id] != nil && $0.attributes == activity.attributes
                    && ($0.activityState == .active || $0.activityState == .stale)
                    && $0.content.state.startedAt >= activity.content.state.startedAt
            })
        else {
            let id = activity.id
            Task { await Self.endActivity(id: id) }
            return
        }
        for older in Activity<RuimteActivityAttributes>.activities
        where
            older.id != activity.id && older.attributes == activity.attributes
            && older.content.state.startedAt < activity.content.state.startedAt
        {
            Task { await self.retire(older) }
        }
        activityStateTasks[activity.id] = Task { [weak self] in
            for await state in activity.activityStateUpdates {
                guard let self, !Task.isCancelled else { break }
                if state == .ended || state == .dismissed {
                    await self.retire(activity, release: state == .ended, cancelStateObserver: false, dismiss: false)
                    break
                }
            }
        }
        activityTasks[activity.id] = Task { [weak self] in
            var uploaded: Data?
            if let token = activity.pushToken, await self?.uploadActivityToken(token, activity: activity) == true {
                uploaded = token
            }
            for await token in activity.pushTokenUpdates {
                guard let self, !Task.isCancelled else { break }
                if token != uploaded, await self.uploadActivityToken(token, activity: activity) {
                    uploaded = token
                }
            }
        }
    }

    private func knowsMachine(_ id: String) -> Bool {
        runtime?.machines.contains(where: { $0.id == id }) == true
            || (try? SharedPushStore().context()?.machinePublicKeys[id]) != nil
    }

    private func uploadActivityToken(_ token: Data, activity: Activity<RuimteActivityAttributes>) async -> Bool {
        let machineID = activity.attributes.machineId
        let collapseID = activity.attributes.collapseId
        let background = NotificationBackgroundLease(name: "Register activity updates")
        defer { background.end() }
        for attempt in 0..<3 {
            do {
                guard let context = try SharedPushStore().context(),
                    let access = try await runtime?.vault?.accessToken(),
                    !Task.isCancelled, enabled, activities, supportsActivities, knowsMachine(machineID),
                    activity.activityState == .active || activity.activityState == .stale,
                    Self.collapseID(machineID: machineID, nodeID: Self.machineActivityNode) == collapseID
                else { return false }
                try await api.activity(
                    handle: context.handle, machineID: machineID, collapseID: collapseID, token: Self.hex(token),
                    startedAt: activity.content.state.startedAt, accessToken: access)
                return true
            } catch is CancellationError { return false } catch {
                if attempt == 2 {
                    problem = error.localizedDescription
                    return false
                }
                do { try await Task.sleep(for: .seconds(attempt == 0 ? 1 : 3)) } catch { return false }
            }
        }
        return false
    }
    func syncBadge(liveKeys: Set<String>) async {
        liveAttentionKeys = liveKeys
        await updateBadge()
    }
    fileprivate func updateBadge() async {
        let offline = (try? SharedPushStore().attentionKeys()) ?? []
        try? await UNUserNotificationCenter.current().setBadgeCount(offline.union(liveAttentionKeys).count)
    }
    func applyRead(machineID: String, nodeID: String, through: Double) async {
        try? await NotificationReadSync.apply(machineID: machineID, nodeID: nodeID, through: through)
        await updateBadge()
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
            runtime?.machines.contains(where: { $0.id == machine }) == true
        else { return }
        if collapse == Self.collapseID(machineID: machine, nodeID: Self.machineActivityNode) {
            if let node = parts.queryItems?.first(where: { $0.name == "node" })?.value,
                !node.isEmpty, node.count <= 256,
                let target = parts.queryItems?.first(where: { $0.name == "target" })?.value,
                target == "terminal" || target == "chat"
            {
                destination = NotificationDestination(machineID: machine, nodeID: node, target: target)
            } else {
                destination = NotificationDestination(machineID: machine, nodeID: "", target: "machine")
            }
        } else if let node = follows[machine]?.first(where: {
            Self.collapseID(machineID: machine, nodeID: $0) == collapse
        }) {
            destination = NotificationDestination(machineID: machine, nodeID: node, target: "unknown")
        }
    }
    fileprivate func respond(data: Data, action: String) async {
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
            await markSeen(machineID: machineID, nodeID: alert.nodeId)
            guard action == "ruimte.allow" || action == "ruimte.deny" else {
                if action == UNNotificationDefaultActionIdentifier { destination = route }
                return
            }
            // Allow or Deny leaves the open project where it was; only an answer that did not land opens the node.
            do {
                guard Double(alert.expiresAt) > Date().timeIntervalSince1970 * 1000 else {
                    throw PushCryptoError.expired
                }
                let actionKey = try PushReplayLedger.nodeKey(
                    machineID: machineID,
                    nodeID: String(
                        decoding: try JSONValue.array([
                            .string("action"), .string(alert.nodeId), .string(alert.requestId ?? ""),
                        ]).encoded(), as: UTF8.self))
                _ = try store.claim(
                    id: actionKey, expiresAt: Double(alert.expiresAt), now: Date().timeIntervalSince1970 * 1000)
                try await answerInBackground(alert, machineID: machineID, allow: action == "ruimte.allow")
            } catch {
                destination = route
                throw error
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
        // Only a chat's request is answered from a notification; a terminal's stays in its TUI.
        guard let runtime, let machine = runtime.machines.first(where: { $0.id == machineID }), alert.requestId != nil,
            alert.kind == .approval, alert.target == .chat
        else { throw PushCryptoError.invalid }
        let session = runtime.session(for: machine)
        session.retain()
        defer { session.release() }
        try await session.waitForConnection()
        guard Double(alert.expiresAt) > Date().timeIntervalSince1970 * 1000 else { throw PushCryptoError.expired }
        let lease = session.rpc.acquireAttachment("chat", id: alert.nodeId)
        defer {
            await withTaskCancellationShield {
                await lease.release()
            }
        }
        let snapshot = try await lease.snapshot(
            payload: .object(["chatId": .string(alert.nodeId), "historyLimit": .number(1)]))
        try Task.checkCancellation()
        let payload = try NotificationApproval.chatPayload(alert: alert, snapshot: snapshot, allow: allow)
        _ = try await session.rpc.request("chat.approve", payload: payload)
    }
    private static let machineActivityNode = "__ruimte_machine_activity__"
    private static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
    private static func collapseID(machineID: String, nodeID: String) -> String {
        let bytes = try! JSONValue.array([.string(machineID), .string(nodeID)]).encoded()
        return Base64URL.encode(Data(SHA256.hash(data: bytes)))
    }
}

@MainActor private enum NotificationReadSync {
    static func apply(machineID: String, nodeID: String, through: Double) async throws {
        let key = try PushReplayLedger.nodeKey(machineID: machineID, nodeID: nodeID)
        let store = try SharedPushStore()
        try store.markRead(node: key, through: through)
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
        let identifiers = delivered.filter { notification in
            let info = notification.request.content.userInfo
            guard info["ruimte.seenKey"] as? String == key else { return false }
            let issuedAt =
                (info["ruimte.issuedAt"] as? NSNumber)?.doubleValue
                ?? ((info["ruimte"] as? [String: Any])?["issuedAt"] as? NSNumber)?.doubleValue
            return issuedAt.map { $0 <= through } ?? false
        }.map { $0.request.identifier }
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
        try await center.setBadgeCount(store.attentionKeys().count)
    }
}

@MainActor private final class NotificationBackgroundLease {
    private var identifier: UIBackgroundTaskIdentifier = .invalid

    init(name: String) {
        identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            Task { @MainActor in self?.end() }
        }
    }

    func end() {
        guard identifier != .invalid else { return }
        let current = identifier
        identifier = .invalid
        UIApplication.shared.endBackgroundTask(current)
    }
}
