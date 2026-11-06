import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

/// A simulator, an emulator or a phone on a machine, from `device.list`.
struct MachineDevice: Identifiable, Equatable, Sendable {
    let deviceID: String
    let backendID: String
    let platform: DevicePlatform
    let kind: DeviceKind
    let name: String
    let runtime: String
    let state: DeviceState
    let reason: String?
    let canBoot: Bool
    let canShutdown: Bool
    let canStream: Bool
    let canInput: Bool

    init(_ device: DeviceInfo) {
        deviceID = device.deviceId
        backendID = device.backendId
        platform = device.platform
        kind = device.kind
        name = device.name
        runtime = device.runtime
        state = device.state
        reason = device.reason
        canBoot = device.capabilities.boot
        canShutdown = device.capabilities.shutdown
        canStream = device.capabilities.stream
        canInput = device.capabilities.input
    }

    var id: String { "\(backendID):\(deviceID)" }

    /// What a request about this device names, `DeviceTargetPayloadSchema`.
    var target: JSONValue {
        .object([
            "deviceId": .string(deviceID), "backendId": .string(backendID), "platform": .string(platform.rawValue),
        ])
    }

    /// How a project file names the device, the way a person does, since the id is the machine's own.
    var reference: JSONValue {
        .object([
            "platform": .string(platform.rawValue), "kind": .string(kind.rawValue), "name": .string(name),
            "runtime": .string(runtime),
        ])
    }

    /// A simulator or emulator that runs, the kind the desktop groups apart.
    var active: Bool { kind == .simulator && state == .booted }
    var booted: Bool { state == .booted }

    var displayRuntime: String {
        guard platform == .ios, runtime.lowercased().hasPrefix("ios ") else { return runtime }
        return String(runtime.dropFirst(4))
    }

    var stateText: String {
        switch reason {
        case "unauthorized": return String(localized: "Allow USB debugging on the device")
        case "offline": return String(localized: "Offline")
        default: break
        }
        if kind == .physical {
            switch state {
            case .booted: return platform == .android ? String(localized: "Connected") : String(localized: "Paired")
            case .shutdown: return String(localized: "Unavailable")
            case .transitioning: return String(localized: "Connecting")
            }
        }
        switch state {
        case .booted: return String(localized: "Running")
        case .shutdown: return String(localized: "Stopped")
        case .transitioning: return String(localized: "Changing state")
        }
    }

    /// Whether a person has something to do on the device itself before it works, which a retry follows up.
    var waitsOnPerson: Bool { reason != nil }
}

/// The devices of a machine in the groups of the desktop's devices panel: what runs first, then per platform and kind.
struct MachineDeviceGroup: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let platform: DevicePlatform
    let active: Bool
    var devices: [MachineDevice]

    static func groups(_ devices: [MachineDevice]) -> [MachineDeviceGroup] {
        var groups: [MachineDeviceGroup] = []
        for device in devices {
            let key = "\(device.active ? "active" : "available"):\(device.platform.rawValue):\(device.kind.rawValue)"
            if let index = groups.firstIndex(where: { $0.id == key }) {
                groups[index].devices.append(device)
            } else {
                groups.append(
                    MachineDeviceGroup(
                        id: key, title: title(device), platform: device.platform, active: device.active,
                        devices: [device]))
            }
        }
        return groups.filter(\.active) + groups.filter { !$0.active }
    }

    private static func title(_ device: MachineDevice) -> String {
        let ios = device.platform == .ios
        if device.active {
            return ios ? String(localized: "Running iOS simulators") : String(localized: "Running Android emulators")
        }
        if device.kind == .physical {
            return ios ? String(localized: "iOS devices") : String(localized: "Android devices")
        }
        return ios ? String(localized: "iOS simulators") : String(localized: "Android emulators")
    }
}

/// The devices of one machine while a page shows them: read with `device.list` and again when the machine says with
/// `device.changed`, or every three seconds on a machine from before `device.watch`, and started or shut down with
/// `device.boot` and `device.shutdown`.
@MainActor @Observable
final class MachineDevices {
    private(set) var devices: [MachineDevice] = []
    /// One line per kind of device the machine could not look for.
    private(set) var notes: [String] = []
    private(set) var loaded = false
    private(set) var loading = false
    /// The machine turned browser and device streaming off, which closes every device request.
    private(set) var streamingOff = false
    private(set) var problem: String?
    /// Per device id, the action on its way.
    private(set) var changing: [String: WireRequest] = [:]
    @ObservationIgnored let client: any MachineRequesting
    @ObservationIgnored private let platform: () -> String?
    @ObservationIgnored private var reads = 0
    @ObservationIgnored private lazy var live = LiveResource(
        client: client, events: [.reread(.deviceChanged)], watch: .area(.deviceWatch, gated: true), poll: { 3_000 },
        read: { [weak self] in await self?.load() })

    /// `platform` is the machine's own, for the line that says iOS needs a Mac instead of asking for Xcode.
    init(client: any MachineRequesting, platform: @escaping () -> String? = { nil }) {
        self.client = client
        self.platform = platform
    }

    var groups: [MachineDeviceGroup] { MachineDeviceGroup.groups(devices) }
    var runningCount: Int { devices.filter(\.booted).count }

    func device(_ id: String) -> MachineDevice? { devices.first { $0.id == id } }

    func load() async {
        reads += 1
        let attempt = reads
        loading = !loaded
        defer { if attempt == reads { loading = false } }
        do {
            let result = try await client.request(.deviceList).decoded(as: DeviceListResult.self)
            guard attempt == reads else { return }
            devices = result.devices.map(MachineDevice.init)
            notes = Self.notes(result.unavailable ?? [], platform: platform())
            streamingOff = false
            problem = nil
            loaded = true
        } catch {
            guard attempt == reads, !(error is CancellationError) else { return }
            if error.machineCode == .streamingDisabled {
                streamingOff = true
                devices = []
                problem = nil
            } else {
                problem = error.localizedDescription
            }
            loaded = true
        }
    }

    /// Keeps the list current for as long as the calling task runs.
    func watch() async { await live.run() }

    func boot(_ device: MachineDevice) async { await control(device, action: .deviceBoot) }
    func shutdown(_ device: MachineDevice) async { await control(device, action: .deviceShutdown) }

    private func control(_ device: MachineDevice, action: WireRequest) async {
        guard changing[device.id] == nil else { return }
        changing[device.id] = action
        defer { changing[device.id] = nil }
        do {
            let answer = try await client.request(action, payload: device.target).decoded(as: DeviceInfo.self)
            let updated = MachineDevice(answer)
            if let index = devices.firstIndex(where: { $0.id == updated.id }) {
                devices[index] = updated
            }
            problem = nil
        } catch {
            problem =
                action == .deviceBoot
                ? String(localized: "Could not start \(device.name). \(error.localizedDescription)")
                : String(localized: "Could not shut down \(device.name). \(error.localizedDescription)")
        }
    }

    /// Away from macOS a missing Xcode is nothing to install, so the iOS lines give way to one that says iOS needs a Mac.
    static func notes(_ unavailable: [DeviceUnavailable], platform: String?) -> [String] {
        let notMac = platform != nil && platform != "darwin"
        var notes: [String] = []
        for entry in unavailable where !(notMac && entry.platform == .ios) {
            let note: String
            switch entry.code {
            case "adb-unavailable":
                note = String(localized: "Install the Android SDK to use Android emulators and devices.")
            case "simctl-unavailable", "devicectl-unavailable":
                note = String(localized: "Install Xcode to use iOS simulators and iPhones.")
            default: note = entry.message
            }
            if !notes.contains(note) { notes.append(note) }
        }
        if notMac { notes.append(String(localized: "iOS simulators need a Mac.")) }
        return notes
    }
}
