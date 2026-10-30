import CoreGraphics
import Foundation
import RuimtePulsar
import RuimteTransport
import Testing
import UIKit

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
        if case .noStream = DeviceView.phase(for: Self.device(stream: false)) {
        } else {
            Issue.record("A device without a stream should say so")
        }
        #expect(DeviceView.canBoot(Self.device(state: "shutdown")))
        #expect(!DeviceView.canBoot(Self.device()))
    }

    @Test func refusalsOfOpeningBecomeStatesAPersonCanReadOrRetry() {
        let format = MachineClientError.server(code: "device-format-unsupported", message: "Update Ruimte")
        #expect(DeviceView.phase(forOpenError: format) == .unsupportedFormat)
        #expect(
            DeviceView.phase(forOpenError: MachineClientError.server(code: "device-not-booted", message: ""))
                == .stopped)
        #expect(
            DeviceView.phase(forOpenError: MachineClientError.server(code: "device-not-found", message: ""))
                == .notOnMachine)
        #expect(
            DeviceView.phase(forOpenError: MachineClientError.server(code: "device-helper-failed", message: "Broke"))
                == .failed("Broke"))
    }

    @Test func buttonsKeepWhatThisVersionKnowsAndDefaultToAnIPhonesOwn() {
        #expect(DeviceView.buttons(Self.device()) == ["home", "swipeHome", "appSwitcher", "lock", "siri"])
        #expect(DeviceView.buttons(Self.device(buttons: ["back", "home", "teleport"])) == ["back", "home"])
    }

    @Test func aTouchLandsAsAShareOfTheFittedScreen() {
        let screen = DeviceView.fitted(CGSize(width: 100, height: 200), in: CGRect(x: 0, y: 0, width: 300, height: 400))
        #expect(screen == CGRect(x: 50, y: 0, width: 200, height: 400))
        #expect(DeviceView.position(of: CGPoint(x: 150, y: 100), in: screen) == CGPoint(x: 0.5, y: 0.25))
        #expect(DeviceView.position(of: CGPoint(x: 40, y: 100), in: screen) == nil)
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
        await machine.waitForInput()
        let input = machine.requests.first { $0.0 == "device.input" }?.1
        #expect(input?["deviceId"] == .string("UDID-1"))
        #expect(input?["input"]?["edge"] == .string("bottom"))
        #expect(input?["input"]?["phase"] == .string("down"))
        #expect(input?["input"]?["x"] == .number(0.5))
        #expect(input?["input"]?["y"] == .number(0.96))
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

    @Test func aPreviewFrameDoesNotDecodeAndPublishOnTheEventCallback() async throws {
        let machine = DeviceMachine(devices: [Self.device()])
        let preview = MachineDevicePreview(client: machine, device: try #require(MachineDevice(Self.device())))
        await preview.start()
        defer { preview.stop() }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let jpeg = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 3), format: format).jpegData(
            withCompressionQuality: 0.8
        ) { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2, height: 3))
        }
        machine.emit(
            .object([
                "deviceId": .string("UDID-1"), "backendId": .string("ios-simulator"), "format": .string("jpeg"),
                "data": .string(jpeg.base64EncodedString()), "sequence": .number(1),
            ]))

        #expect(preview.image == nil)
    }

    @Test func theDefaultDecoderReadsJPEGAndRejectsInvalidBytes() async {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let jpeg = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 3), format: format).jpegData(
            withCompressionQuality: 0.8
        ) { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2, height: 3))
        }
        let image = await DeviceFrameDecoder.image(jpeg.base64EncodedString())
        #expect(image?.size == CGSize(width: 2, height: 3))
        #expect(await DeviceFrameDecoder.image("not base64") == nil)
        #expect(await DeviceFrameDecoder.image(Data("not an image".utf8).base64EncodedString()) == nil)
    }

    @Test func decodingKeepsOnlyTheLatestPendingFrameAndSurvivesABadImage() async {
        let probe = FrameProbe()
        let decoder = DeviceFrameDecoder(decode: { await probe.decode($0) }, show: probe.show)
        let first = UIImage()
        let last = UIImage()
        decoder.submit("first")
        await probe.waitForRequests(1)
        decoder.submit("superseded")
        decoder.submit("bad-image")
        #expect(probe.inputs == ["first"])
        probe.complete(0, image: first)
        await probe.waitForRequests(2)
        #expect(probe.inputs == ["first", "bad-image"])
        #expect(probe.images.count == 1 && probe.images.first === first)

        decoder.submit("last")
        probe.complete(1, image: nil)
        await probe.waitForRequests(3)
        #expect(probe.images.count == 1 && probe.images.first === first)
        probe.complete(2, image: last)
        await probe.waitForImages(2)
        #expect(probe.inputs == ["first", "bad-image", "last"])
        #expect(probe.images.last === last)
    }

    @Test func aResetDiscardsOldWorkBeforeDecodingTheRestartedStreamsLatestFrame() async {
        let probe = FrameProbe()
        let decoder = DeviceFrameDecoder(decode: { await probe.decode($0) }, show: probe.show)
        decoder.submit("old")
        await probe.waitForRequests(1)
        decoder.submit("old-pending")
        decoder.reset()
        decoder.submit("new-superseded")
        decoder.submit("new")
        #expect(probe.inputs == ["old"])
        probe.complete(0, image: UIImage())
        await probe.waitForRequests(2)
        #expect(probe.inputs == ["old", "new"])
        #expect(probe.images.isEmpty)
        let fresh = UIImage()
        probe.complete(1, image: fresh)
        await probe.waitForImages(1)
        #expect(probe.images.count == 1 && probe.images.first === fresh)
    }

    @Test func previewsThrottleAndFilterFramesAndRejectAStoppedStreamsResult() async throws {
        let machine = DeviceMachine(devices: [Self.device()])
        let probe = FrameProbe()
        var instant: TimeInterval = 0
        let preview = MachineDevicePreview(
            client: machine, device: try #require(MachineDevice(Self.device())), now: { instant },
            decode: { await probe.decode($0) })
        await preview.start()
        defer { preview.stop() }
        machine.emit(Self.frame("wrong-device").setting("deviceId", .string("other")))
        machine.emit(Self.frame("video").setting("format", .string("h264")))
        machine.emit(Self.frame("first"))
        await probe.waitForRequests(1)
        machine.emit(Self.frame("too-soon"))
        instant = 0.249
        machine.emit(Self.frame("still-too-soon"))
        instant = 0.25
        machine.emit(Self.frame("superseded"))
        instant = 0.5
        machine.emit(Self.frame("last"))
        let first = UIImage()
        probe.complete(0, image: first)
        await probe.waitForRequests(2)
        #expect(probe.inputs == ["first", "last"])
        #expect(preview.image === first)

        preview.stop()
        await preview.start()
        machine.emit(Self.frame("restart"))
        probe.complete(1, image: UIImage())
        await probe.waitForRequests(3)
        #expect(preview.image === first)
        instant = 0.75
        machine.emit(Self.frame("barrier"))
        let fresh = UIImage()
        probe.complete(2, image: fresh)
        await probe.waitForRequests(4)
        #expect(probe.inputs == ["first", "last", "restart", "barrier"])
        #expect(preview.image === fresh)
        preview.stop()
        probe.complete(3, image: nil)
    }

    @Test func aDeviceViewFiltersAndCoalescesEncodedFramesAndDropsOldResultsOnReopen() async {
        let machine = DeviceMachine(devices: [Self.device()])
        let probe = FrameProbe()
        let model = DeviceViewModel(client: machine, reference: Self.reference, decode: { await probe.decode($0) })
        model.start()
        defer { model.stop() }
        await model.refresh()
        machine.emit(Self.frame("wrong-backend").setting("backendId", .string("other")))
        machine.emit(Self.frame("video").setting("format", .string("h264")))
        machine.emit(Self.frame("first", sequence: 1))
        await probe.waitForRequests(1)
        machine.emit(Self.frame("duplicate", sequence: 1))
        machine.emit(Self.frame("superseded", sequence: 2))
        machine.emit(Self.frame("last", sequence: 3))
        let first = UIImage()
        probe.complete(0, image: first)
        await probe.waitForRequests(2)
        #expect(probe.inputs == ["first", "last"])
        #expect(model.frame === first)

        model.stop()
        model.start()
        await model.refresh()
        machine.emit(Self.frame("restart", sequence: 1))
        probe.complete(1, image: UIImage())
        await probe.waitForRequests(3)
        #expect(model.frame === first)
        machine.emit(Self.frame("barrier", sequence: 2))
        let fresh = UIImage()
        probe.complete(2, image: fresh)
        await probe.waitForRequests(4)
        #expect(probe.inputs == ["first", "last", "restart", "barrier"])
        #expect(model.frame === fresh)
        model.stop()
        probe.complete(3, image: nil)
    }

    private static func frame(_ data: String, sequence: Int = 0) -> JSONValue {
        .object([
            "deviceId": .string("UDID-1"), "backendId": .string("ios-simulator"), "format": .string("jpeg"),
            "data": .string(data), "sequence": .number(Double(sequence)),
        ])
    }
}

@MainActor private final class FrameProbe {
    private(set) var inputs: [String] = []
    private(set) var images: [UIImage] = []
    private var completions: [Int: CheckedContinuation<UIImage?, Never>] = [:]
    private var requests: [(Int, CheckedContinuation<Void, Never>)] = []
    private var publications: [(Int, CheckedContinuation<Void, Never>)] = []

    func decode(_ data: String) async -> UIImage? {
        await withCheckedContinuation { continuation in
            let index = inputs.count
            inputs.append(data)
            completions[index] = continuation
            let ready = requests.filter { $0.0 <= inputs.count }
            requests.removeAll { $0.0 <= inputs.count }
            for (_, arrival) in ready { arrival.resume() }
        }
    }

    func show(_ image: UIImage) {
        images.append(image)
        let ready = publications.filter { $0.0 <= images.count }
        publications.removeAll { $0.0 <= images.count }
        for (_, arrival) in ready { arrival.resume() }
    }

    func complete(_ index: Int, image: UIImage?) {
        completions.removeValue(forKey: index)?.resume(returning: image)
    }

    func waitForRequests(_ count: Int) async {
        guard inputs.count < count else { return }
        await withCheckedContinuation { requests.append((count, $0)) }
    }

    func waitForImages(_ count: Int) async {
        guard images.count < count else { return }
        await withCheckedContinuation { publications.append((count, $0)) }
    }
}

@MainActor private final class DeviceMachine: MachineRequesting {
    var devices: [JSONValue]
    var openRefusal: String?
    var requests: [(String, JSONValue)] = []
    private let inputArrival = NativeArrival()
    private var handlers: [UUID: @MainActor @Sendable (JSONValue) -> Void] = [:]

    func waitForInput() async {
        await inputArrival.wait()
    }

    init(devices: [JSONValue]) { self.devices = devices }

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if type == "device.input" { inputArrival.record() }
        switch type {
        case "device.list": return .object(["devices": .array(devices)])
        case "device.open":
            if let openRefusal { throw MachineClientError.server(code: openRefusal, message: openRefusal) }
            return (devices.first ?? .object([:])).setting("streamId", .string("device:1"))
        default: return .object([:])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void {
        guard event == "device.frame" else { return {} }
        let id = UUID()
        handlers[id] = handler
        return { [weak self] in self?.handlers[id] = nil }
    }

    func emit(_ payload: JSONValue) {
        for handler in handlers.values { handler(payload) }
    }

    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void { {} }
}
