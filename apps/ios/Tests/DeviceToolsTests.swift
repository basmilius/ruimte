import Foundation
import RuimtePulsar
import RuimteTransport
import Testing

@testable import Ruimte

@Suite @MainActor struct DeviceToolsTests {
    private static let reference: JSONValue = .object([
        "platform": .string("ios"), "kind": .string("simulator"), "name": .string("iPhone 18 Pro"),
        "runtime": .string("iOS 27.0"),
    ])

    private static func device(
        kind: String = "simulator", platform: String = "ios", state: String = "booted", tools: [String]? = nil,
        permissions: [String]? = nil
    ) -> JSONValue {
        var capabilities: [String: JSONValue] = [
            "boot": .bool(true), "shutdown": .bool(true), "stream": .bool(true), "input": .bool(true),
            "screenshot": .bool(true),
        ]
        if let tools { capabilities["tools"] = .array(tools.map(JSONValue.string)) }
        if let permissions { capabilities["permissions"] = .array(permissions.map(JSONValue.string)) }
        return .object([
            "deviceId": .string("UDID-1"), "backendId": .string("simctl"), "platform": .string(platform),
            "kind": .string(kind), "name": .string("iPhone 18 Pro"), "runtime": .string("iOS 27.0"),
            "state": .string(state), "capabilities": .object(capabilities),
        ])
    }

    @Test func aSimulatorThatAnnouncesNoToolsHasTheOldSixteenAndAPhoneNone() {
        #expect(
            DeviceTools.tools(Self.device()) == [
                "openUrl", "launchApp", "terminateApp", "appearance", "textSize", "liquidGlass", "colorFilter",
                "reduceMotion",
                "increaseContrast", "reduceTransparency", "showBorders", "voiceOver", "location", "clearLocation",
                "permissions", "push",
            ])
        #expect(DeviceTools.tools(Self.device(kind: "physical")).isEmpty)
        #expect(DeviceTools.tools(Self.device(tools: ["capture", "keyboard"])) == ["capture", "keyboard"])
    }

    @Test func permissionsKeepTheirOrderAndOnlyWhatTheDeviceNames() {
        #expect(
            DeviceTools.permissions(Self.device()) == [
                "camera", "microphone", "photos", "contacts", "calendar", "reminders", "location", "motion",
                "media-library",
                "faceid",
            ])
        #expect(
            DeviceTools.permissions(Self.device(permissions: ["photos", "camera", "teleport"])) == ["camera", "photos"])
    }

    @Test func onlyASimulatorOrEmulatorThatAnnouncesEraseCanBeErased() {
        #expect(DeviceTools.canErase(Self.device(tools: ["erase"])))
        #expect(!DeviceTools.canErase(Self.device(tools: ["capture"])))
        #expect(!DeviceTools.canErase(Self.device(kind: "physical", tools: ["erase"])))
    }

    @Test func anActionCarriesTheTargetAndItsFields() {
        let payload = DeviceTools.action(Self.device(), "setAppearance", ["value": .string("dark")])
        #expect(
            payload
                == .object([
                    "deviceId": .string("UDID-1"), "backendId": .string("simctl"), "platform": .string("ios"),
                    "action": .string("setAppearance"), "value": .string("dark"),
                ]))
    }

    @Test func commandChordsStayTheAppsExceptPaste() {
        #expect(DeviceKeys.route(usage: 0x04, command: false) == .key(0x04))
        #expect(DeviceKeys.route(usage: 0x19, command: true) == .paste)
        #expect(DeviceKeys.route(usage: 0x04, command: true) == .pass)
        #expect(DeviceKeys.route(usage: 0xE3, command: false) == .pass)
        #expect(DeviceKeys.route(usage: 0, command: false) == .pass)
    }

    @Test func aScreenshotIsNamedAfterTheDeviceAndTheMoment() {
        let previous = NSTimeZone.default
        NSTimeZone.default = TimeZone(secondsFromGMT: 0)!
        defer { NSTimeZone.default = previous }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var components = DateComponents()
        (components.year, components.month, components.day) = (2026, 10, 15)
        (components.hour, components.minute, components.second) = (9, 41, 7)
        let date = calendar.date(from: components)!
        #expect(DeviceTools.captureName("iPad/Pro: 13", at: date) == "iPad-Pro- 13 2026-10-15 at 09.41.07.png")
    }

    @Test func aChangeGoesOutAsAnActionAndTheAnswerIsTheNewSettings() async {
        let machine = ToolsMachine(devices: [Self.device(tools: ["appearance"])])
        let model = DeviceToolsModel(client: machine, device: Self.device(tools: ["appearance"]))
        await model.load()
        #expect(model.setting("appearance") == .string("light"))

        #expect(await model.act("setAppearance", ["value": .string("dark")]))
        #expect(model.setting("appearance") == .string("dark"))
        #expect(machine.requests.last?.1["action"] == .string("setAppearance"))

        machine.refusal = "device-action-unavailable"
        #expect(!(await model.act("setAppearance", ["value": .string("light")])))
        #expect(model.problem != nil)
    }

    @Test func eraseStopsARunningSimulatorErasesItAndStartsItAgain() async {
        let machine = ToolsMachine(devices: [Self.device(tools: ["erase"])])
        let model = DeviceViewModel(client: machine, reference: Self.reference)
        await model.refresh()
        #expect(model.canErase)

        await model.erase()

        let steps = machine.requests.map(\.0).filter {
            [.deviceShutdown, .deviceAction, .deviceBoot].contains($0)
        }
        #expect(steps == [.deviceShutdown, .deviceAction, .deviceBoot])
        #expect(machine.requests.first { $0.0 == .deviceAction }?.1["action"] == .string("erase"))
    }

    @Test func keysGoOutOnlyToADeviceThatAnnouncesTheKeyboard() async {
        let machine = ToolsMachine(devices: [Self.device(tools: ["keyboard"])])
        let model = DeviceViewModel(client: machine, reference: Self.reference)
        await model.refresh()
        #expect(model.takesKeys)
        model.key("down", usage: 0x04)
        await machine.waitForInput()
        #expect(
            machine.requests.first { $0.0 == .deviceInput }?.1["input"]
                == .object(["kind": .string("key"), "phase": .string("down"), "usage": .number(4)]))

        let unsupported = ToolsMachine(devices: [Self.device()])
        let plain = DeviceViewModel(client: unsupported, reference: Self.reference)
        await plain.refresh()
        #expect(!plain.takesKeys)
        let unsupportedInput = NativeTaskDrain { plain.key("down", usage: 0x04) }
        await unsupportedInput.finish()
        model.key("up", usage: 0x04)
        await machine.waitForInput(count: 2)
        #expect(!unsupported.requests.contains { $0.0 == .deviceInput })
    }
}

@MainActor private final class ToolsMachine: MachineRequesting {
    var devices: [JSONValue]
    var refusal: String?
    var requests: [(WireRequest, JSONValue)] = []
    private var settings: [String: JSONValue] = ["appearance": .string("light")]
    private let inputArrival = NativeArrival()

    func waitForInput(count: Int = 1) async {
        await inputArrival.wait(for: count)
    }

    init(devices: [JSONValue]) { self.devices = devices }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if type == .deviceInput { inputArrival.record() }
        if let refusal, type == .deviceAction { throw MachineClientError.server(code: refusal, message: refusal) }
        switch type {
        case .deviceList: return .object(["devices": .array(devices)])
        case .deviceOpen: return (devices.first ?? .object([:])).setting("streamId", .string("device:1"))
        case .deviceDetail: return .object(["settings": .object(settings)])
        case .deviceAction:
            if payload.text("action") == "setAppearance" { settings["appearance"] = payload["value"] }
            return .object(["settings": .object(settings)])
        case .deviceShutdown, .deviceBoot: return devices.first ?? .object([:])
        default: return .object([:])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
