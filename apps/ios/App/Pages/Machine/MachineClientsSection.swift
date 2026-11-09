import Observation
import RuimtePulsar
import RuimteShared
import RuimteTransport
import SwiftUI

/// One client connected to a machine now, from `client.list`, as it told of itself.
struct ConnectedMachineClient: Identifiable, Equatable {
    let id: String
    /// `local`, `account`, `machine` or `mcp`; a newer kind reads as an unknown app.
    let access: String
    let label: String?
    let client: String?
    let version: String?
    let os: String?
    let osVersion: String?
    let device: String?
    let reachability: String?
    let connectedAt: Date
    let lastRequestAt: Date?
    let current: Bool

    init(_ value: ConnectedClient) {
        id = value.id
        access = value.access
        label = value.label
        client = value.client
        version = value.version
        os = value.os
        osVersion = value.osVersion
        device = value.device
        reachability = value.reachability?.rawValue
        connectedAt = Date(timeIntervalSince1970: value.connectedAt / 1000)
        lastRequestAt = value.lastRequestAt.map { Date(timeIntervalSince1970: $0 / 1000) }
        current = value.current
    }

    /// The desktop's `clientIcon`: the device goes before the app, so Station on a phone draws a phone.
    var icon: String {
        if access == "mcp" { return "plug" }
        if access == "machine" { return "server" }
        if device == "phone" || (client == "ios" && device == nil) { return "smartphone" }
        if device == "tablet" { return "tablet" }
        if client == "station" || client == "browser" { return "globe" }
        if client == "desktop" || device == "desktop" { return "laptop" }
        return "circle-question-mark"
    }

    var name: String {
        if access == "mcp" { return "MCP · \(label ?? "")" }
        if access == "machine" { return String(localized: "Another machine") }
        switch client {
        case "desktop":
            switch os {
            case "macos": return "Ruimte for Mac"
            case "windows": return "Ruimte for Windows"
            case "linux": return "Ruimte for Linux"
            default: return "Ruimte"
            }
        case "ios": return device == "tablet" ? "iPad" : "iPhone"
        case "station": return "station.ruimte.app"
        case "browser": return String(localized: "Browser")
        default: return String(localized: "Unknown app")
        }
    }

    /// The fields that tell two connections apart beyond their id and time.
    fileprivate var groupKey: [String?] {
        access == "mcp" ? [id] : [access, label, client, version, os, osVersion, device, reachability]
    }
}

/// Connections equal on everything but id and time, as one row with the earliest time.
struct ConnectedClientGroup: Identifiable, Equatable {
    var client: ConnectedMachineClient
    var count: Int
    var current: Bool
    var connectedAt: Date

    var id: String { client.id }

    static func groups(_ clients: [ConnectedMachineClient]) -> [ConnectedClientGroup] {
        var groups: [ConnectedClientGroup] = []
        for client in clients {
            if let index = groups.firstIndex(where: { $0.client.groupKey == client.groupKey }) {
                groups[index].count += 1
                groups[index].current = groups[index].current || client.current
                groups[index].connectedAt = min(groups[index].connectedAt, client.connectedAt)
            } else {
                groups.append(
                    ConnectedClientGroup(
                        client: client, count: 1, current: client.current, connectedAt: client.connectedAt))
            }
        }
        return groups
    }

    /// Session, system, release, reach and time, as the desktop writes it; what is unknown is left out, except a version.
    func detail(now: Date = Date()) -> String {
        if client.access == "mcp" {
            let ago = Format.ago(milliseconds: now.timeIntervalSince(client.lastRequestAt ?? connectedAt) * 1000)
            return String(localized: "Last request \(ago)", comment: "%@ is a relative time")
        }
        let machine = client.access == "machine"
        let system = client.os.map {
            [Self.systems[$0] ?? $0, client.osVersion].compactMap(\.self).joined(separator: " ")
        }
        let ago = Format.ago(milliseconds: now.timeIntervalSince(connectedAt) * 1000)
        let parts: [String?] = [
            machine ? nil : client.label,
            system,
            machine ? nil : (client.version ?? String(localized: "Unknown version")),
            reach,
            String(localized: "connected \(ago)", comment: "%@ is a relative time"),
            count > 1 ? String(localized: "\(count) connections") : nil,
        ]
        return parts.compactMap(\.self).joined(separator: " · ")
    }

    private var reach: String? {
        switch client.reachability {
        case nil: nil
        case "loopback": String(localized: "This computer")
        case "lan": String(localized: "Local network")
        default: String(localized: "Internet")
        }
    }

    private static let systems = [
        "macos": "macOS", "windows": "Windows", "linux": "Linux", "ios": "iOS", "ipados": "iPadOS",
        "android": "Android", "chromeos": "ChromeOS",
    ]
}

/// What is connected to one machine, live while a sheet shows it: `client.watch` held again after every reconnect.
@MainActor @Observable
final class MachineClients {
    private(set) var groups: [ConnectedClientGroup] = []
    /// Nil until the link opened once, false on a machine that does not answer `client.list`.
    private(set) var answers: Bool?
    private(set) var problem: String?
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private lazy var live = LiveResource(
        client: client, events: [.reread(.clientChanged)], watch: .area(.clientWatch, gated: true),
        prepare: { [weak self] in
            guard let self else { return }
            answers = (client as? MachineFeatures)?.answers(.clientList) == true
            if answers != true { groups = [] }
        }, read: { [weak self] in await self?.load() })

    init(client: any MachineRequesting) {
        self.client = client
    }

    func start() { live.start() }

    func stop() { live.stop() }

    /// An external MCP client goes quiet without a word from the machine, so its row is read again while one shows.
    var showsExternal: Bool { groups.contains { $0.client.access == "mcp" } }

    func refresh() async { await live.refresh() }

    private func load() async {
        guard answers == true else { return }
        do {
            let result = try await client.request(.clientList).decoded(as: ClientListResult.self)
            groups = ConnectedClientGroup.groups(result.clients.map(ConnectedMachineClient.init))
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// The desktop's Connected now, above the clients with access: the iPhone's sheet and the iPad's both show it.
struct MachineClientsSection: View {
    @State private var model: MachineClients

    init(session: SharedMachineSession) {
        _model = State(initialValue: MachineClients(client: session.rpc))
    }

    var body: some View {
        Group {
            if model.answers != false {
                Section {
                    if model.answers == nil {
                        MobileLoadingRow(String(localized: "Loading devices")).frame(maxWidth: .infinity)
                    }
                    TimelineView(.periodic(from: .now, by: 60)) { timeline in
                        ForEach(model.groups) { group in
                            row(group, now: timeline.date)
                        }
                    }
                    if let problem = model.problem {
                        Text(problem).foregroundStyle(MobileStyle.statusError)
                    }
                } header: {
                    Text("Connected now")
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if model.showsExternal { await model.refresh() }
            }
        }
    }

    private func row(_ group: ConnectedClientGroup, now: Date) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.medium) {
            MobileStatusGlyph(tone: .idle, symbol: group.client.icon).centeredOnFirstLine(of: .body)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(group.client.name).lineLimit(1)
                    if group.current {
                        Text("· this device").font(.caption).foregroundStyle(MobileStyle.muted)
                    }
                }
                Text(group.detail(now: now)).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}
