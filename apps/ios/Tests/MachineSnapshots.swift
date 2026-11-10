import Foundation
import RuimtePulsar
import RuimteShared
import RuimteTransport
import SwiftUI
import Testing
import UIKit

@testable import Ruimte

/// Renders the Machines tab (two machines, one offline), a machine's page with usage limits and the Settings sheet
/// from fixtures to PNG files for review, in light and dark. Runs only when `RUIMTE_MACHINE_SNAPSHOTS` names a folder
/// (`TEST_RUNNER_RUIMTE_MACHINE_SNAPSHOTS` through `xcodebuild`), since it waits on layout.
@Suite(.serialized) @MainActor struct MachineSnapshots {
    private nonisolated static let folder = ProcessInfo.processInfo.environment["RUIMTE_MACHINE_SNAPSHOTS"]

    private static let providers = [
        UsageWidgetSnapshot.Provider(
            kind: "claude",
            windows: [
                .init(kind: "session", label: "Session", used: 0.42, resetsAt: nil),
                .init(kind: "weekly", label: "Weekly", used: 0.86, resetsAt: nil),
            ]),
        UsageWidgetSnapshot.Provider(
            kind: "codex",
            windows: [
                .init(kind: "session", label: "Session", used: 0.12, resetsAt: nil),
                .init(kind: "weekly", label: "Weekly", used: 0.31, resetsAt: nil),
            ]),
    ]

    @Test(.enabled(if: folder != nil)) func machines() async throws {
        let limits = MachineLimits.of(providers: Self.providers, accounts: .unknown)
        let rows = [
            MachineFixture(
                id: "mac", name: "MacBook Pro", icon: "laptop", reach: "Direct · 12 ms", connected: true, update: true,
                limits: limits),
            MachineFixture(
                id: "studio", name: "Studio", icon: "monitor", reach: "Last connected 2 hours ago", connected: false,
                retries: true),
        ]
        let page = MobileList {
            MachineLimitLegend().listRowInsets(MachinesPage.textInsets)
            ForEach(rows) { row in
                MachineRow(
                    name: row.name, icon: row.icon, reach: row.reach, connected: row.connected, update: row.update,
                    limits: row.limits, retry: row.retries ? {} : nil, open: {}
                )
                .mobileCard(padding: 0, filled: true)
                .listRowInsets(NowSections.cardInsets)
            }
            Button {
            } label: {
                Label(String(localized: "Add machine"), lucideIcon: "plus")
            }
            .buttonStyle(.mobileCapsule)
            .listRowInsets(
                EdgeInsets(
                    top: MobileSpacing.large, leading: MobileSpacing.margin, bottom: MobileSpacing.large,
                    trailing: MobileSpacing.margin))
        }
        try await render(page.navigationTitle("Machines").navigationBarTitleDisplayMode(.large), name: "machines")
    }

    @Test(.enabled(if: folder != nil)) func machinePage() async throws {
        let connections = MachineConnections(monitorPaths: false)
        defer { connections.shutdown() }
        let runtime = AppRuntime(connections: connections)
        let mac = machine("mac", name: "MacBook Pro")
        let widgetMachines = UsageWidgetStore.machines()
        defer { UsageWidgetStore.setMachines(widgetMachines) }
        UsageWidgetStore.setMachines(widgetMachines + [UsageWidgetMachine(id: mac.id, name: mac.name)])
        UsageWidgetStore.save(UsageWidgetSnapshot(providers: Self.providers), machineID: mac.id)
        runtime.machines = [mac]
        let page = MachinePage(session: runtime.session(for: mac), runtime: runtime)
        try await render(page, name: "machine")
    }

    @Test(.enabled(if: folder != nil)) func settings() async throws {
        let connections = MachineConnections(monitorPaths: false)
        defer { connections.shutdown() }
        let runtime = AppRuntime(connections: connections)
        runtime.machines = [machine("mac", name: "MacBook Pro"), machine("studio", name: "Studio")]
        let defaults = try #require(UserDefaults(suiteName: "machine-snapshots-\(UUID().uuidString)"))
        let settings = MobileSettings(runtime: runtime, projects: UnifiedProjects(defaults: defaults))
        try await render(settings.modifier(MobileSheetSurface()), name: "settings", stacked: false)
    }

    private func render(_ view: some View, name: String, stacked: Bool = true) async throws {
        for dark in [false, true] {
            let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.overrideUserInterfaceStyle = dark ? .dark : .light
            let root: AnyView =
                stacked
                ? AnyView(NavigationStack { view.modifier(MobilePageSurface()) }) : AnyView(view)
            window.rootViewController = UIHostingController(
                rootView: root.foregroundStyle(MobileStyle.text).tint(MobileStyle.accent))
            window.isHidden = false
            try await Task.sleep(for: .milliseconds(800))
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            window.isHidden = true
            let folder = URL(fileURLWithPath: try #require(Self.folder), isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try #require(image.pngData())
                .write(to: folder.appendingPathComponent("\(name)-\(dark ? "dark" : "light").png"))
        }
    }

    private func machine(_ id: String, name: String) -> Machine {
        Machine(
            id: "snapshot-\(id)-\(UUID().uuidString)", name: name, icon: nil, publicKey: DeviceKey().publicKey,
            brokerUrl: nil, lastSeenAt: nil)
    }
}

private struct MachineFixture: Identifiable {
    let id: String
    let name: String
    let icon: String
    let reach: String
    let connected: Bool
    var update = false
    var limits = MachineLimits()
    var retries = false
}
