import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit

/// The pure part of a device's tools: which ones it announces and what goes on the wire, as the desktop's
/// `deviceTools` reads them.
enum DeviceTools {
    /// What a simulator from before the list was announced has, which is what `deviceTools` assumes for one.
    static let simulatorFallback = WireVocabulary.iosSimulatorTools
    static let toggles = WireVocabulary.deviceToggleSettings
    static let display = ["appearance", "textSize", "liquidGlass", "colorFilter"] + toggles
    static let apps = ["openUrl", "launchApp", "terminateApp"]
    static let textSizes = WireVocabulary.deviceTextSizes
    static let colorFilters = WireVocabulary.deviceColorFilters
    static let permissions = WireVocabulary.devicePermissions
    /// City names and their coordinates, which read the same in every language.
    static let locations: [(name: String, latitude: Double, longitude: Double)] = [
        ("San Francisco", 37.7749, -122.4194), ("New York", 40.7128, -74.006), ("London", 51.5074, -0.1278),
        ("Amsterdam", 52.3676, 4.9041), ("Tokyo", 35.6762, 139.6503),
    ]

    /// The tools a device announces, or a simulator's when it announces none; a tool this version does not know
    /// stays out.
    static func tools(_ device: DeviceInfo) -> [String] {
        guard let announced = device.capabilities.tools else {
            return device.platform == .ios && device.kind == .simulator ? simulatorFallback : []
        }
        return announced
    }

    /// The permissions a device can set; every one when it names none.
    static func permissions(_ device: DeviceInfo) -> [String] {
        guard let announced = device.capabilities.permissions else { return permissions }
        return permissions.filter(Set(announced).contains)
    }

    /// Only a person erases, and only a simulator or an emulator; a phone is never erased.
    static func canErase(_ device: DeviceInfo) -> Bool {
        tools(device).contains("erase") && device.kind != .physical
    }

    static func action(_ device: DeviceInfo, _ name: String, _ fields: [String: JSONValue] = [:]) -> JSONValue {
        var payload = DeviceView.target(device)
        payload["action"] = .string(name)
        payload.merge(fields) { _, new in new }
        return .object(payload)
    }
}

/// Where a key a person presses on a hardware keyboard goes while a device's screen shows.
enum DeviceKeyRoute: Equatable {
    /// A key of the device, as its HID usage.
    case key(Int)
    /// ⌘V, which pastes the person's own clipboard so accents and emoji arrive too.
    case paste
    /// A chord of the app's, which stays with its shortcuts.
    case pass
}

enum DeviceKeys {
    static let keyV = 0x19
    static let commandKeys: Set<Int> = [0xE3, 0xE7]

    /// Every chord with ⌘ stays the app's, as on the desktop, except paste.
    static func route(usage: Int, command: Bool) -> DeviceKeyRoute {
        if command || commandKeys.contains(usage) {
            return usage == keyV ? .paste : .pass
        }
        return (1...0xFFFF).contains(usage) ? .key(usage) : .pass
    }
}

/// The settings of one device and the changes a person makes in its tools sheet, through `device.detail`,
/// `device.action`, `device.capture` and `device.clipboard`.
@MainActor @Observable
final class DeviceToolsModel {
    let client: any MachineRequesting
    let device: DeviceInfo
    private(set) var settings: DeviceSettings?
    private(set) var pending = false
    private(set) var problem: String?

    init(client: any MachineRequesting, device: DeviceInfo) {
        self.client = client
        self.device = device
    }

    var tools: [String] { DeviceTools.tools(device) }
    /// A tool reached through a request of its own, which the machine has to name too.
    var canCapture: Bool { tools.contains("capture") && answers(.deviceCapture) }
    var canClipboard: Bool { tools.contains("clipboard") && answers(.deviceClipboard) }

    func has(_ tool: String) -> Bool { tools.contains(tool) }

    func load() async {
        do {
            let detail = try await client.request(.deviceDetail, payload: .object(DeviceView.target(device)))
                .decoded(as: DeviceDetail.self)
            settings = detail.settings
        } catch {
            problem = error.localizedDescription
        }
    }

    @discardableResult func act(_ name: String, _ fields: [String: JSONValue] = [:]) async -> Bool {
        pending = true
        problem = nil
        defer { pending = false }
        do {
            let detail = try await client.request(.deviceAction, payload: DeviceTools.action(device, name, fields))
                .decoded(as: DeviceDetail.self)
            settings = detail.settings
            return true
        } catch {
            problem = error.localizedDescription
            return false
        }
    }

    /// A screenshot the machine takes and writes, read back here into a file the share sheet hands on.
    func capture() async -> URL? {
        pending = true
        problem = nil
        defer { pending = false }
        do {
            let result = try await client.request(.deviceCapture, payload: .object(DeviceView.target(device)))
                .decoded(as: DeviceCaptureResult.self)
            let data = try await read(result.path)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(
                DeviceTools.captureName(device.name, at: Date()))
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            problem = error.localizedDescription
            return nil
        }
    }

    /// Sends the text on this phone's clipboard to the device's.
    func sendClipboard() async {
        guard let text = UIPasteboard.general.string else { return }
        await clipboard(["text": .string(text)])
    }

    func copyClipboard() async {
        if let result = await clipboard([:]) { UIPasteboard.general.string = result.text }
    }

    @discardableResult private func clipboard(_ fields: [String: JSONValue]) async -> DeviceClipboardResult? {
        var payload = DeviceView.target(device)
        payload.merge(fields) { _, new in new }
        do {
            return try await client.request(.deviceClipboard, payload: .object(payload))
                .decoded(as: DeviceClipboardResult.self)
        } catch {
            problem = error.localizedDescription
            return nil
        }
    }

    private func read(_ path: String) async throws -> Data {
        try await client.readResource(.object(["kind": .string("file"), "path": .string(path)])).data
    }

    private func answers(_ request: WireRequest) -> Bool {
        (client as? MachineClient)?.answers(request) == true
    }
}

extension DeviceTools {
    /// The name a screenshot is shared under, the way the desktop saves one.
    static func captureName(_ deviceName: String, at date: Date) -> String {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let name = deviceName.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        return "\(name) \(format.string(from: date)).png"
    }
}

extension DeviceInfo {
    /// The device a `device.open` answer describes, which is the listed device with the stream it was opened on.
    init(_ opened: DeviceOpenResult) {
        self.init(
            deviceId: opened.deviceId, backendId: opened.backendId, platform: opened.platform, kind: opened.kind,
            name: opened.name, runtime: opened.runtime, state: opened.state, reason: opened.reason,
            capabilities: opened.capabilities)
    }
}

extension DeviceSettings {
    /// A choice by the name the tools sheet and the wire give it, as the word the wire writes.
    func choice(_ key: String) -> String? {
        switch key {
        case "appearance": appearance?.rawValue
        case "textSize": textSize?.rawValue
        case "liquidGlass": liquidGlass?.rawValue
        case "colorFilter": colorFilter?.rawValue
        case "statusBar": statusBar?.rawValue
        default: nil
        }
    }

    /// A switch by the name the tools sheet and the wire give it.
    func toggle(_ key: String) -> Bool? {
        switch key {
        case "reduceMotion": reduceMotion
        case "increaseContrast": increaseContrast
        case "reduceTransparency": reduceTransparency
        case "showBorders": showBorders
        case "voiceOver": voiceOver
        case "biometricEnrolled": biometricEnrolled
        default: nil
        }
    }
}
