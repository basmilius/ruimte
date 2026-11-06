import Foundation
import Observation
import RuimtePulsar
import RuimteShared
import RuimteTransport

/// A file of a version. Its name is a label, never a path, and a file is read by its place in the version.
typealias OutputFile = ArtifactFile

extension ArtifactFile {
    var bytes: Double { Double(size) }
    /// What Share and Quick Look need on the phone first, whole.
    var readable: Bool { bytes <= WireConstants.bytesReadMaxBytes }
    var isImage: Bool { mime.hasPrefix("image/") }
    var isText: Bool { mime.hasPrefix("text/") && mime != "text/html" }
    /// The last part of the label, for a file on the phone and a title.
    var shortName: String { name.split(separator: "/").last.map(String.init) ?? name }
}

/// Who made a version, as the machine recorded it from the context of the call; nothing in it comes from an agent.
typealias OutputProvenance = ArtifactProvenance

typealias OutputVersion = ArtifactVersion

extension ArtifactVersion: Identifiable {
    public var id: String { versionId }

    /// Epoch milliseconds, as the times of a thread are.
    var created: Double { Double(createdAt) }
    var date: Date { Date(timeIntervalSince1970: created / 1000) }

    /// "v3, 25 Oct, 20:19", as the desktop labels a version.
    var label: String {
        String(
            localized: "v\(number), \(Format.dayClock(date))", comment: "A version: its number, then its day and time")
    }
}

/// A row of the list: an item with its latest version.
typealias OutputItem = ArtifactSummary

extension ArtifactSummary: Identifiable {
    public var id: String { artifactId }
}

enum OutputKind {
    static let known = WireVocabulary.artifactKinds

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

    static func makerIcon(_ maker: ArtifactProvenanceMaker) -> String {
        switch maker {
        case .person: "user"
        case .routine: "calendar-clock"
        case .agent: "bot"
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
    private var live: LiveResource?

    func start(
        _ client: any MachineRequesting, gated: Bool = false,
        changed: @escaping @MainActor @Sendable (ArtifactChangedEvent) -> Void,
        connection: @escaping @MainActor @Sendable (Bool) -> Void = { _ in },
        reload: @escaping @MainActor @Sendable () async -> Void
    ) {
        guard live == nil else { return }
        let live = LiveResource(
            client: client, events: [.apply(.artifactChanged, as: ArtifactChangedEvent.self, changed)],
            watch: LiveWatch(
                start: .artifactWatch, stop: .artifactUnwatch, needs: gated ? .artifactList : nil),
            connection: connection,
            read: {
                if !gated || OutputMachine.answers(client) { await reload() }
            })
        self.live = live
        live.start()
    }

    func stop() {
        live?.stop()
        live = nil
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
            changed: { [weak self] event in
                guard let self, event.projectId == projectID else { return }
                Task { await self.load() }
            },
            connection: { [weak self] in self?.reachable = $0 },
            reload: { [weak self] in await self?.load() })
    }

    func stop() { watch.stop() }

    func load() async {
        do {
            let answer = try await client.request(.artifactList, payload: .object(["projectId": .string(projectID)]))
                .decoded(as: ArtifactListResult.self)
            items = answer.artifacts
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
    private(set) var providers: [ProviderInfo] = []
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
            changed: { [weak self] event in
                guard let self, event.artifactId == artifactID else { return }
                if event.removed == true {
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
                .decoded(as: ArtifactGetResult.self)
            title = answer.artifact.title
            kind = answer.artifact.kind
            versions = answer.versions
            chatPresent = answer.chatPresent
            gone = versions.isEmpty
            reachable = true
            problem = nil
        } catch is CancellationError {
            return
        } catch let error as MachineClientError where error.code == .notFound {
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
        if providers.isEmpty,
            let answer = try? await client.request(.providerList).decoded(as: ProviderListResult.self)
        {
            providers = answer.providers
            AgentDirectory.shared.learn(providers)
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
        case .person: return String(localized: "You")
        case .routine: return String(localized: "Routine")
        case .agent: break
        }
        let catalog = providers.first { $0.kind == provenance.agent }
        if let model = provenance.model, !model.isEmpty {
            return ModelName.of(model, in: catalog?.models ?? [])
        }
        return catalog?.name ?? String(localized: "Agent")
    }
}
