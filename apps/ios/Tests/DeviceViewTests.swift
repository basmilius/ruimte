import CoreGraphics
import Foundation
import RuimtePulsar
import RuimteTransport
import Testing

@testable import Ruimte

@Suite @MainActor struct DeviceViewTests {
    private static let reference: JSONValue = .object([
        "platform": .string("ios"), "kind": .string("simulator"), "name": .string("iPhone 17 Pro"),
        "runtime": .string("iOS 26.1"),
    ])

    private static func device(state: String = "booted", stream: Bool = true, buttons: [String]? = nil) -> JSONValue {
        var capabilities: [String: JSONValue] = [
            "boot": .bool(true), "shutdown": .bool(true), "stream": .bool(stream), "input": .bool(true),
            "screenshot": .bool(true),
        ]
        if let buttons { capabilities["buttons"] = .array(buttons.map(JSONValue.string)) }
        return .object([
            "deviceId": .string("UDID-1"), "backendId": .string("ios-simulator"), "platform": .string("ios"),
            "kind": .string("simulator"), "name": .string("iPhone 17 Pro"), "runtime": .string("iOS 26.1"),
            "state": .string(state), "capabilities": .object(capabilities),
        ])
    }

    @Test func aReferenceFindsTheDeviceByWhatAPersonCallsIt() {
        let other = Self.device().setting("runtime", .string("iOS 18.4"))
        #expect(DeviceView.resolve(Self.reference, in: [other, Self.device()]) == Self.device())
        #expect(DeviceView.resolve(Self.reference, in: [other]) == nil)
    }

    @Test func aDeviceInTheListSaysWhatThePageShows() {
        #expect(DeviceView.phase(for: Self.device()) == .starting)
        #expect(DeviceView.phase(for: Self.device(state: "shutdown")) == .stopped)
        #expect(DeviceView.phase(for: Self.device(state: "transitioning")) == .starting)
        if case .noStream = DeviceView.phase(for: Self.device(stream: false)) {} else {
            Issue.record("A device without a stream should say so")
        }
        #expect(DeviceView.canBoot(Self.device(state: "shutdown")))
        #expect(!DeviceView.canBoot(Self.device()))
    }

    @Test func refusalsOfOpeningBecomeStatesAPersonCanReadOrRetry() {
        let format = MachineClientError.server(code: "device-format-unsupported", message: "Update Ruimte")
        #expect(DeviceView.phase(forOpenError: format) == .unsupportedFormat)
        #expect(
            DeviceView.phase(forOpenError: MachineClientError.server(code: "device-not-booted", message: "")) == .stopped)
        #expect(
            DeviceView.phase(forOpenError: MachineClientError.server(code: "device-not-found", message: ""))
                == .notOnMachine)
        #expect(
            DeviceView.phase(forOpenError: MachineClientError.server(code: "device-helper-failed", message: "Broke"))
                == .failed("Broke"))
    }

    @Test func buttonsKeepWhatThisVersionKnowsAndDefaultToAnIPhonesOwn() {
        #expect(DeviceView.buttons(Self.device()) == DeviceView.iosButtons)
        #expect(DeviceView.buttons(Self.device(buttons: ["back", "home", "teleport"])) == ["back", "home"])
    }

    @Test func aTouchLandsAsAShareOfTheFittedScreen() {
        let screen = DeviceView.fitted(CGSize(width: 100, height: 200), in: CGRect(x: 0, y: 0, width: 300, height: 400))
        #expect(screen == CGRect(x: 100, y: 0, width: 200, height: 400))
        #expect(DeviceView.position(of: CGPoint(x: 200, y: 100), in: screen) == CGPoint(x: 0.5, y: 0.25))
        #expect(DeviceView.position(of: CGPoint(x: 50, y: 100), in: screen) == nil)
        let pointer = DeviceView.pointer("down", at: CGPoint(x: 0.5, y: 0.95), fromBottom: true)
        #expect(pointer["edge"] == .string("bottom"))
        #expect(DeviceView.pointer("up", at: .zero)["edge"] == nil)
    }

    @Test func aBootedSimulatorOpensAsJPEGEventsAndTakesTaps() async {
        let machine = DeviceMachine(devices: [Self.device()])
        let model = DeviceViewModel(client: machine, reference: Self.reference)
        await model.refresh()
        #expect(model.phase == .streaming)
        let open = machine.requests.first { $0.0 == "device.open" }?.1
        #expect(open?["stream"] == .string("events"))
        #expect(open?["formats"] == .array([.string("jpeg")]))

        model.touch("down", at: CGPoint(x: 0.5, y: 0.96))
        for _ in 0..<20 where !machine.requests.contains(where: { $0.0 == "device.input" }) { await Task.yield() }
        let input = machine.requests.first { $0.0 == "device.input" }?.1
        #expect(input?["deviceId"] == .string("UDID-1"))
        #expect(input?["input"]?["edge"] == .string("bottom"))
    }

    @Test func aDeviceThatStreamsVideoOrIsMissingSaysSoInsteadOfAScreen() async {
        let machine = DeviceMachine(devices: [Self.device()])
        machine.openRefusal = "device-format-unsupported"
        let model = DeviceViewModel(client: machine, reference: Self.reference)
        await model.refresh()
        #expect(model.phase == .unsupportedFormat)
        await model.refresh()
        #expect(machine.requests.filter { $0.0 == "device.open" }.count == 1)

        machine.devices = []
        await model.refresh()
        #expect(model.phase == .notOnMachine)

        machine.devices = [Self.device(state: "shutdown")]
        await model.refresh()
        #expect(model.phase == .stopped)
        #expect(model.canBoot)
    }

    @Test func aViewWithoutADeviceNeverAsksTheMachine() async {
        let machine = DeviceMachine(devices: [])
        let model = DeviceViewModel(client: machine, reference: nil)
        await model.refresh()
        #expect(model.phase == .noReference)
        #expect(machine.requests.isEmpty)
    }
}

@MainActor private final class DeviceMachine: MachineRequesting {
    var devices: [JSONValue]
    var openRefusal: String?
    var requests: [(String, JSONValue)] = []

    init(devices: [JSONValue]) { self.devices = devices }

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        switch type {
        case "device.list": return .object(["devices": .array(devices)])
        case "device.open":
            if let openRefusal { throw MachineClientError.server(code: openRefusal, message: openRefusal) }
            return (devices.first ?? .object([:])).setting("streamId", .string("device:1"))
        default: return .object([:])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
