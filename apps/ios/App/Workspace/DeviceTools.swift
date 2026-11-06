import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit

/// The pure part of a device's tools: which ones it announces and what goes on the wire, as the desktop's
/// `deviceTools` reads them.
enum DeviceTools {
    /// What a simulator from before the list was announced has, which is what `deviceTools` assumes for one.
    static let simulatorFallback = [
        "openUrl", "launchApp", "terminateApp", "appearance", "textSize", "liquidGlass", "colorFilter", "reduceMotion",
        "increaseContrast", "reduceTransparency", "showBorders", "voiceOver", "location", "clearLocation",
        "permissions",
        "push",
    ]
    static let toggles = ["reduceMotion", "increaseContrast", "reduceTransparency", "showBorders", "voiceOver"]
    static let display = ["appearance", "textSize", "liquidGlass", "colorFilter"] + toggles
    static let apps = ["openUrl", "launchApp", "terminateApp"]
    static let textSizes = ["small", "default", "large", "extra-large"]
    static let colorFilters = ["none", "grayscale", "red-green", "green-red", "blue-yellow"]
    static let permissions = [
        "camera", "microphone", "photos", "contacts", "calendar", "reminders", "location", "motion", "media-library",
        "faceid",
    ]
    /// City names and their coordinates, which read the same in every language.
    static let locations: [(name: String, latitude: Double, longitude: Double)] = [
        ("San Francisco", 37.7749, -122.4194), ("New York", 40.7128, -74.006), ("London", 51.5074, -0.1278),
        ("Amsterdam", 52.3676, 4.9041), ("Tokyo", 35.6762, 139.6503),
    ]

    /// The tools a device announces, or a simulator's when it announces none; a tool this version does not know
    /// stays out.
    static func tools(_ device: JSONValue) -> [String] {
        guard let announced = device["capabilities"]?["tools"]?.arrayValue else {
            return device.text("platform") == "ios" && device.text("kind") == "simulator" ? simulatorFallback : []
        }
        return announced.compactMap(\.stringValue)
    }

    /// The permissions a device can set; every one when it names none.
    static func permissions(_ device: JSONValue) -> [String] {
        guard let announced = device["capabilities"]?["permissions"]?.arrayValue else { return permissions }
        let names = Set(announced.compactMap(\.stringValue))
        return permissions.filter(names.contains)
    }

    /// Only a person erases, and only a simulator or an emulator; a phone is never erased.
    static func canErase(_ device: JSONValue) -> Bool {
        tools(device).contains("erase") && device.text("kind") != "physical"
    }

    static func action(_ device: JSONValue, _ name: String, _ fields: [String: JSONValue] = [:]) -> JSONValue {
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
    let device: JSONValue
    private(set) var settings: JSONValue?
    private(set) var pending = false
    private(set) var problem: String?

    init(client: any MachineRequesting, device: JSONValue) {
        self.client = client
        self.device = device
    }

    var tools: [String] { DeviceTools.tools(device) }
    /// A tool reached through a request of its own, which the machine has to name too.
    var canCapture: Bool { tools.contains("capture") && answers(.deviceCapture) }
    var canClipboard: Bool { tools.contains("clipboard") && answers(.deviceClipboard) }

    func has(_ tool: String) -> Bool { tools.contains(tool) }

    func setting(_ key: String) -> JSONValue? { settings?[key] }

    func load() async {
        do {
            let detail = try await client.request(.deviceDetail, payload: .object(DeviceView.target(device)))
            settings = detail["settings"] ?? .object([:])
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
            settings = detail["settings"] ?? settings
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
            let data = try await read(result.text("path"))
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(
                DeviceTools.captureName(device.text("name"), at: Date()))
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
        if let result = await clipboard([:]) { UIPasteboard.general.string = result.text("text") }
    }

    @discardableResult private func clipboard(_ fields: [String: JSONValue]) async -> JSONValue? {
        var payload = DeviceView.target(device)
        payload.merge(fields) { _, new in new }
        do {
            return try await client.request(.deviceClipboard, payload: .object(payload))
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
