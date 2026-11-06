import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// A file of a version. Its name is a label, never a path, and a file is read by its place in the version.
struct OutputFile: Equatable {
    let name: String
    let mime: String
    let size: Double

    init(json: JSONValue) {
        name = json.text("name")
        mime = json.text("mime")
        size = json.number("size")
    }

    /// What Share and Quick Look need on the phone first, whole.
    var readable: Bool { size <= WireConstants.bytesReadMaxBytes }
    var isImage: Bool { mime.hasPrefix("image/") }
    var isText: Bool { mime.hasPrefix("text/") && mime != "text/html" }
    /// The last part of the label, for a file on the phone and a title.
    var shortName: String { name.split(separator: "/").last.map(String.init) ?? name }
}

/// Who made a version, as the machine recorded it from the context of the call; nothing in it comes from an agent.
struct OutputProvenance: Equatable {
    let maker: String
    let chatID: String?
    let agent: String?
    let model: String?
    let turnID: String?

    init(json: JSONValue) {
        maker = json.text("maker")
        chatID = json["chatId"]?.stringValue
        turnID = json["turnId"]?.stringValue
        agent = json["agent"]?.stringValue
        model = json["model"]?.stringValue
    }
}

struct OutputVersion: Equatable, Identifiable {
    let id: String
    let number: Int
    /// Epoch milliseconds.
    let createdAt: Double
    let files: [OutputFile]
    let bytes: Double
    let provenance: OutputProvenance

    init(json: JSONValue) {
        id = json.text("versionId")
        number = Int(json.number("number"))
        createdAt = json.number("createdAt")
        files = json.list("files").map(OutputFile.init(json:))
        bytes = json.number("bytes")
        provenance = OutputProvenance(json: json["provenance"] ?? .object([:]))
    }

    var date: Date { Date(timeIntervalSince1970: createdAt / 1000) }

    /// "v3, 25 Oct, 20:19", as the desktop labels a version.
    var label: String {
        String(
            localized: "v\(number), \(Format.dayClock(date))", comment: "A version: its number, then its day and time")
    }
}

/// A row of the list: an item with its latest version.
struct OutputItem: Equatable, Identifiable {
    let id: String
    let title: String
    let kind: String
    let latest: OutputVersion
    let versionCount: Int

    init(json: JSONValue) {
        id = json.text("artifactId")
        title = json.text("title")
        kind = json.text("kind")
        latest = OutputVersion(json: json["latest"] ?? .object([:]))
        versionCount = max(1, Int(json.number("versionCount")))
    }
}

enum OutputKind {
    static let known = ["report", "image", "build", "export", "recording", "page"]

    /// A kind this version does not know is drawn as an export, a file to keep, as the desktop does.
    static func drawn(_ kind: String) -> String { known.contains(kind) ? kind : "export" }

    static func icon(_ kind: String) -> String {
        switch drawn(kind) {
        case "report": "file-text"
        case "image": "image"
        case "build": "box"
        case "recording": "video"
        case "page": "app-window"
        default: "sheet"
        }
    }

    static func makerIcon(_ maker: String) -> String {
        switch maker {
        case "person": "user"
        case "routine": "calendar-clock"
        default: "bot"
        }
    }
}

/// The list's headings: newest first, in runs of Today, This week and Earlier.
struct OutputGroup: Equatable, Identifiable {
    enum Period: Equatable { case today, week, earlier }
    let period: Period
    var items: [OutputItem]
    var id: Period { period }

    var title: String {
        switch period {
        case .today: String(localized: "Today")
        case .week: String(localized: "This week")
        case .earlier: String(localized: "Earlier")
        }
    }

    static func period(_ date: Date, now: Date, calendar: Calendar = .current) -> Period {
        let today = calendar.startOfDay(for: now)
        if date >= today { return .today }
        let week = calendar.date(byAdding: .day, value: -6, to: today) ?? today
        return date >= week ? .week : .earlier
    }

    static func groups(_ items: [OutputItem], now: Date, calendar: Calendar = .current) -> [OutputGroup] {
        let sorted = items.sorted { $0.latest.createdAt > $1.latest.createdAt }
        var groups: [OutputGroup] = []
        for item in sorted {
            let period = period(item.latest.date, now: now, calendar: calendar)
            if groups.last?.period == period {
                groups[groups.count - 1].items.append(item)
            } else {
                groups.append(OutputGroup(period: period, items: [item]))
            }
        }
        return groups
    }
}

enum OutputMachine {
    /// Output is newer than the oldest machine the app talks to, so every entry asks first and hides otherwise.
    @MainActor static func answers(_ client: any MachineRequesting) -> Bool {
        (client as? MachineFeatures)?.answers(.artifactList) == true
    }

    /// The hold on `artifact.watch` that `artifact.changed` comes under.
    @MainActor static func watch(_ client: any MachineRequesting) -> MachineSubscription {
        client.acquireSubscription(
            start: .artifactWatch, stop: .artifactUnwatch,
            payload: .object([:]), stopPayload: .object([:]))
    }

    /// A failure that says the link is gone rather than that the machine refused.
    static func unreachable(_ error: any Error) -> Bool {
        switch error as? MachineClientError {
        case .disconnected?, .timeout?: true
        default: false
        }
    }
}

/// `artifact.watch` while a page shows Output, held again after every reconnect, since what changed while the link was
/// down was pushed to nobody. The hold starts at the first connection; `gated` waits for a machine that names
/// `artifact.list`, which is known only once it is connected.
@MainActor final class OutputWatch {
    private var stops: [() -> Void] = []
    private var lease: MachineSubscription?

    func start(
        _ client: any MachineRequesting, gated: Bool = false,
        changed: @escaping @MainActor @Sendable (JSONValue) -> Void,
        connection: @escaping @MainActor @Sendable (Bool) -> Void = { _ in },
        reload: @escaping @MainActor @Sendable () async -> Void
    ) {
        guard stops.isEmpty else { return }
        stops.append(
            client.subscribe(.artifactChanged) { [weak self] payload in
                if self?.lease != nil { changed(payload) }
            })
        stops.append(
            client.observeConnection { [weak self] available in
                connection(available)
                guard let self, available, !gated || OutputMachine.answers(client) else { return }
                let lease = lease ?? OutputMachine.watch(client)
                self.lease = lease
                Task {
                    _ = try? await lease.refresh()
                    await reload()
                }
            })
    }

    func stop() {
        stops.forEach { $0() }
        stops.removeAll()
        let lease = lease
        self.lease = nil
        Task { await lease?.release() }
    }
}

/// What the machine keeps of one project's Output, live while a page shows it.
@MainActor @Observable final class ProjectOutput {
    let client: any MachineRequesting
    let projectID: String
    /// Nil until the machine answered.
    private(set) var items: [OutputItem]?
    private(set) var reachable = true
    private(set) var problem: String?
    @ObservationIgnored private let watch = OutputWatch()

    init(client: any MachineRequesting, projectID: String) {
        self.client = client
        self.projectID = projectID
    }

    func groups(now: Date) -> [OutputGroup] { OutputGroup.groups(items ?? [], now: now) }

    func start() {
        watch.start(
            client,
            changed: { [weak self] payload in
                guard let self, payload.text("projectId") == projectID else { return }
                Task { await self.load() }
            },
            connection: { [weak self] in self?.reachable = $0 },
            reload: { [weak self] in await self?.load() })
    }

    func stop() { watch.stop() }

    func load() async {
        do {
            let answer = try await client.request(.artifactList, payload: .object(["projectId": .string(projectID)]))
            items = answer.list("artifacts").map(OutputItem.init(json:))
            reachable = true
            problem = nil
        } catch is CancellationError {
        } catch {
            if OutputMachine.unreachable(error) {
                reachable = false
            } else {
                problem = error.localizedDescription
            }
        }
    }
}

/// One item with every version, live like the list. `pinned` is the version a sidebar view keeps to.
@MainActor @Observable final class OutputItemModel {
    let client: any MachineRequesting
    let artifactID: String
    private(set) var title: String?
    private(set) var kind = "export"
    /// Newest first.
    private(set) var versions: [OutputVersion] = []
    private(set) var chatPresent = false
    /// The item is no longer in Output.
    private(set) var gone = false
    private(set) var reachable = true
    private(set) var problem: String?
    /// The CLIs the machine knows, for the name of the model that made a version.
    private(set) var providers: [JSONValue] = []
    var selectedID: String?
    @ObservationIgnored private let watch = OutputWatch()

    init(client: any MachineRequesting, artifactID: String, pinned: String? = nil) {
        self.client = client
        self.artifactID = artifactID
        selectedID = pinned
    }

    var loaded: Bool { !versions.isEmpty }
    var latest: OutputVersion? { versions.first }

    /// The version on screen; nil once the one picked was removed.
    var version: OutputVersion? {
        guard let selectedID else { return latest }
        return versions.first { $0.id == selectedID }
    }

    func start() {
        watch.start(
            client,
            changed: { [weak self] payload in
                guard let self, payload.text("artifactId") == artifactID else { return }
                if payload["removed"]?.boolValue == true {
                    gone = true
                } else {
                    Task { await self.load() }
                }
            },
            connection: { [weak self] in self?.reachable = $0 },
            reload: { [weak self] in await self?.load() })
    }

    func stop() { watch.stop() }

    func load() async {
        do {
            let answer = try await client.request(.artifactGet, payload: .object(["artifactId": .string(artifactID)]))
            let artifact = answer["artifact"] ?? .object([:])
            title = artifact.text("title")
            kind = artifact.text("kind")
            versions = answer.list("versions").map(OutputVersion.init(json:))
            chatPresent = answer["chatPresent"]?.boolValue ?? false
            gone = versions.isEmpty
            reachable = true
            problem = nil
        } catch is CancellationError {
            return
        } catch MachineClientError.server(let code, _) where code == "not-found" {
            gone = true
            return
        } catch {
            if OutputMachine.unreachable(error) {
                reachable = false
            } else {
                problem = error.localizedDescription
            }
            return
        }
        if providers.isEmpty, let answer = try? await client.request(.providerList) {
            providers = answer.list("providers")
        }
    }

    /// The bytes of one file of a version, read by the item's id, the version's id and the file's place.
    func read(_ version: OutputVersion, file index: Int) async throws -> Data {
        let file = version.files[index]
        let resource: JSONValue = .object([
            "kind": .string("artifact"), "artifactId": .string(artifactID), "versionId": .string(version.id),
            "file": .number(Double(index)),
        ])
        return try await client.readResource(resource, maxBytes: max(Int(file.size), 1)).data
    }

    /// "You", "Routine", or the model an agent ran, named as its CLI names it; a version saved before the machine
    /// noted either says Agent.
    func maker(_ provenance: OutputProvenance) -> String {
        switch provenance.maker {
        case "person": return String(localized: "You")
        case "routine": return String(localized: "Routine")
        default: break
        }
        let catalog = providers.first { $0.text("kind") == provenance.agent }
        if let model = provenance.model, !model.isEmpty {
            return ModelName.of(model, in: catalog?.list("models") ?? [])
        }
        return catalog?["name"]?.stringValue ?? String(localized: "Agent")
    }
}
