import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

/// What a device view shows, from finding the device a project names to its screen.
enum DeviceViewPhase: Equatable {
    case noReference
    case finding
    /// The machine has no device of that name and runtime; a project file travels between machines.
    case notOnMachine
    case listFailed(String)
    /// Stopped, or between states. A phone that is plugged out or locked reads as stopped too.
    case stopped
    case starting
    /// The machine cannot capture this device's screen.
    case noStream(String)
    /// The device streams video this app does not decode, which is a phone or an Android emulator.
    case unsupportedFormat
    case streaming
    case failed(String)
    /// The link to the machine dropped; the last screen stays, dimmed, until it is back.
    case offline
}

/// The pure part of a device view: which device a reference names, what goes on the wire and where a touch lands.
enum DeviceView {
    /// Where a swipe from the bottom starts, as the desktop's stream reads it, so a swipe up from there goes home.
    static let bottomEdge = 0.92
    static let iosButtons = ["home", "swipeHome", "appSwitcher", "lock", "siri"]
    static let knownButtons: Set<String> = ["home", "back", "swipeHome", "appSwitcher", "lock", "siri"]

    /// A reference names a device the way a person does, since the machine's id means nothing on another machine.
    static func matches(_ device: JSONValue, _ reference: JSONValue) -> Bool {
        ["platform", "kind", "name", "runtime"].allSatisfy { device.text($0) == reference.text($0) }
    }

    static func resolve(_ reference: JSONValue, in devices: [JSONValue]) -> JSONValue? {
        devices.first { matches($0, reference) }
    }

    static func target(_ device: JSONValue) -> [String: JSONValue] {
        [
            "deviceId": .string(device.text("deviceId")), "backendId": .string(device.text("backendId")),
            "platform": .string(device.text("platform")),
        ]
    }

    /// The buttons the device announces that this version knows; a machine from before the list had an iPhone's.
    static func buttons(_ device: JSONValue) -> [String] {
        guard let announced = device["capabilities"]?["buttons"]?.arrayValue else { return iosButtons }
        return announced.compactMap(\.stringValue).filter(knownButtons.contains)
    }

    /// What a device in the list means for the page; `starting` for one that is booted and can be shown.
    static func phase(for device: JSONValue) -> DeviceViewPhase {
        switch device.text("state") {
        case "booted":
            device["capabilities"]?["stream"]?.boolValue == true
                ? .starting : .noStream("This machine cannot show this device's screen.")
        case "transitioning": .starting
        default: .stopped
        }
    }

    static func canBoot(_ device: JSONValue) -> Bool {
        device.text("state") == "shutdown" && device["capabilities"]?["boot"]?.boolValue == true
    }

    /// What a refusal of `device.open` means for the page.
    static func phase(forOpenError error: Error) -> DeviceViewPhase {
        if case MachineClientError.server(let code, let message) = error {
            switch code {
            case "device-format-unsupported": return .unsupportedFormat
            case "device-not-booted": return .stopped
            case "device-not-found": return .notOnMachine
            case "device-capture-unavailable", "platform-unavailable": return .noStream(message)
            default: return .failed(message)
            }
        }
        return .failed(error.localizedDescription)
    }

    /// Where a point lies on the screen of the device, as a share from its top left; nil outside it.
    static func position(of point: CGPoint, in screen: CGRect) -> CGPoint? {
        guard screen.width > 0, screen.height > 0, screen.contains(point) else { return nil }
        return CGPoint(
            x: min(1, max(0, (point.x - screen.minX) / screen.width)),
            y: min(1, max(0, (point.y - screen.minY) / screen.height)))
    }

    /// The rectangle a picture of this size takes when it fits inside `bounds`, centered.
    static func fitted(_ size: CGSize, in bounds: CGRect) -> CGRect {
        guard size.width > 0, size.height > 0 else { return .zero }
        let scale = min(bounds.width / size.width, bounds.height / size.height)
        let fitted = CGSize(width: size.width * scale, height: size.height * scale)
        return CGRect(
            x: bounds.midX - fitted.width / 2, y: bounds.midY - fitted.height / 2, width: fitted.width,
            height: fitted.height)
    }

    static func pointer(_ phase: String, at position: CGPoint, fromBottom: Bool = false) -> JSONValue {
        var input: [String: JSONValue] = [
            "kind": .string("pointer"), "phase": .string(phase), "x": .number(position.x), "y": .number(position.y),
        ]
        if fromBottom { input["edge"] = .string("bottom") }
        return .object(input)
    }
}

/// One device view: finds its device on the machine, starts it when asked, and shows its screen from `device.frame`
/// events, sending taps and swipes back with `device.input`. Only JPEG frames are drawn, which is what simulators
/// send; a device that streams video gets a message instead.
@MainActor @Observable
final class DeviceViewModel {
    let client: any MachineRequesting
    let reference: JSONValue?
    private(set) var phase: DeviceViewPhase
    private(set) var device: JSONValue?
    private(set) var frame: UIImage?
    private(set) var booting = false
    @ObservationIgnored private var subscriptions: [() -> Void] = []
    @ObservationIgnored private var poll: Task<Void, Never>?
    @ObservationIgnored private var opened: [String: JSONValue]?
    @ObservationIgnored private var lastSequence = -1
    @ObservationIgnored private var decoding = false
    /// The newest frame that came in while another was decoded, so the screen never stops on a stale one.
    @ObservationIgnored private var pending: Data?
    @ObservationIgnored private var lastMove = Date.distantPast
    @ObservationIgnored private var gestureFromBottom = false

    init(client: any MachineRequesting, reference: JSONValue?) {
        self.client = client
        self.reference = reference
        phase = reference == nil ? .noReference : .finding
    }

    var buttons: [String] { device.map(DeviceView.buttons) ?? [] }
    var takesInput: Bool { phase == .streaming && device?["capabilities"]?["input"]?.boolValue == true }
    var canBoot: Bool { device.map(DeviceView.canBoot) ?? false }
    var canStop: Bool {
        device?.text("state") == "booted" && device?["capabilities"]?["shutdown"]?.boolValue == true
    }
    var title: String { reference.map { "\($0.text("name")) · \($0.text("runtime"))" } ?? "Device" }

    func start() {
        guard reference != nil, subscriptions.isEmpty else { return }
        subscriptions.append(client.subscribe("device.frame") { [weak self] payload in self?.receive(payload) })
        subscriptions.append(
            client.observeConnection { [weak self] connected in
                guard let self else { return }
                if connected {
                    if phase == .offline { phase = .finding }
                    startPolling()
                } else {
                    opened = nil
                    poll?.cancel()
                    if frame != nil || phase == .streaming { phase = .offline }
                }
            })
    }

    func stop() {
        poll?.cancel()
        poll = nil
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
        detach()
    }

    func boot() async {
        guard let device, !booting else { return }
        booting = true
        defer { booting = false }
        do {
            let info = try await client.request(
                "device.boot", payload: .object(DeviceView.target(device)))
            self.device = info
            phase = .starting
            await refresh()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func shutdown() async {
        guard let device else { return }
        detach()
        do {
            self.device = try await client.request("device.shutdown", payload: .object(DeviceView.target(device)))
            frame = nil
            phase = .stopped
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func retry() {
        opened = nil
        phase = .finding
        startPolling()
    }

    func press(_ button: String) { send(.object(["kind": .string("button"), "button": .string(button)])) }
    func rotate(left: Bool) {
        send(.object(["kind": .string("rotate"), "direction": .string(left ? "left" : "right")]))
    }

    /// A touch on the screen, as down, moves and up. Moves go out at most every 16 ms; the last one always does.
    func touch(_ phase: String, at position: CGPoint) {
        guard takesInput else { return }
        if phase == "down" {
            gestureFromBottom = position.y >= DeviceView.bottomEdge
        } else if phase == "move" {
            let now = Date()
            guard now.timeIntervalSince(lastMove) >= 0.016 else { return }
            lastMove = now
        }
        send(DeviceView.pointer(phase, at: position, fromBottom: phase == "down" && gestureFromBottom))
    }

    private func send(_ input: JSONValue) {
        guard let device, phase == .streaming else { return }
        var payload = DeviceView.target(device)
        payload["input"] = input
        Task { _ = try? await client.request("device.input", payload: .object(payload)) }
    }

    private func startPolling() {
        poll?.cancel()
        poll = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await refresh()
                let streaming = phase == .streaming
                do { try await Task.sleep(for: .seconds(streaming ? 5 : 2)) } catch { return }
            }
        }
    }

    func refresh() async {
        guard let reference else { return }
        do {
            let result = try await client.request("device.list", payload: .object([:]))
            guard let found = DeviceView.resolve(reference, in: result.list("devices")) else {
                device = nil
                frame = nil
                detach()
                phase = .notOnMachine
                return
            }
            device = found
            let next = DeviceView.phase(for: found)
            guard found.text("state") == "booted", next == .starting else {

                detach()
                frame = nil
                phase = next
                return
            }
            // A refusal waits for Reload, or for the device to stop and start again.
            guard opened == nil, !waitsForRetry else { return }
            await open(found)
        } catch MachineClientError.disconnected {
            phase = .offline
        } catch {
            if device == nil { phase = .listFailed(error.localizedDescription) }
        }
    }

    private var waitsForRetry: Bool {
        switch phase {
        case .failed, .noStream, .unsupportedFormat: true
        default: false
        }
    }

    private func open(_ device: JSONValue) async {
        if phase != .streaming { phase = .starting }
        var payload = DeviceView.target(device)
        payload["stream"] = .string("events")
        payload["formats"] = .array([.string("jpeg")])
        do {
            let info = try await client.request("device.open", payload: .object(payload))
            opened = DeviceView.target(info)
            self.device = info
            lastSequence = -1
            phase = .streaming
        } catch {
            phase = DeviceView.phase(forOpenError: error)
        }
    }

    private func detach() {
        guard let opened else { return }
        self.opened = nil
        Task { [client] in _ = try? await client.request("device.detach", payload: .object(opened)) }
    }

    private func receive(_ payload: JSONValue) {
        guard let opened, payload.text("deviceId") == opened["deviceId"]?.stringValue,
            payload.text("backendId") == opened["backendId"]?.stringValue
        else { return }
        let sequence = Int(payload.number("sequence"))
        guard payload.text("format", fallback: "jpeg") == "jpeg", sequence != lastSequence,
            let data = Data(base64Encoded: payload.text("data"))
        else { return }
        lastSequence = sequence
        guard !decoding else {
            pending = data
            return
        }
        decode(data)
    }

    private func decode(_ data: Data) {
        decoding = true
        Task.detached(priority: .userInitiated) { [weak self] in
            let image = UIImage(data: data)?.preparingForDisplay()
            await self?.show(image)
        }
    }

    private func show(_ image: UIImage?) {
        decoding = false
        if let image, phase == .streaming || phase == .starting {
            frame = image
            phase = .streaming
        }
        if let next = pending {
            pending = nil
            decode(next)
        }
    }

}

struct DeviceViewPage: View {
    @State private var model: DeviceViewModel

    init(client: any MachineRequesting, reference: JSONValue?) {
        _model = State(initialValue: DeviceViewModel(client: client, reference: reference))
    }

    var body: some View {
        ZStack {
            MobileStyle.canvas.ignoresSafeArea()
            if let frame = model.frame, model.phase == .streaming || model.phase == .offline {
                DeviceScreen(image: frame, model: model)
                    .opacity(model.phase == .offline ? 0.4 : 1)
                    .padding(.horizontal, 16).padding(.vertical, 8)
            } else {
                message
            }
        }
        .overlay(alignment: .top) {
            if model.phase == .offline {
                pill("Reconnecting to the machine", icon: "wifi-off")
            } else if model.phase == .streaming && !model.takesInput {
                pill("Read-only preview", icon: "eye")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if model.takesInput && !model.buttons.isEmpty {
                controls
            }
        }
        .toolbar {
            ToolbarItem(id: "device.actions", placement: .topBarTrailing) {
                Menu {
                    Section(model.title) {
                        if model.takesInput {
                            ForEach(model.buttons.filter { !["home", "back"].contains($0) }, id: \.self) { button in
                                Button(DeviceViewPage.label(button), lucideIcon: DeviceViewPage.icon(button)) {
                                    model.press(button)
                                }
                            }
                            Button("Rotate left", lucideIcon: "rotate-ccw") { model.rotate(left: true) }
                            Button("Rotate right", lucideIcon: "rotate-cw") { model.rotate(left: false) }
                        }
                        Button("Reload", lucideIcon: "refresh-cw") { model.retry() }
                    }
                    if model.canStop {
                        Button("Stop device", lucideIcon: "power", role: .destructive) {
                            Task { await model.shutdown() }
                        }
                    }
                } label: {
                    Image(lucide: "ellipsis")
                }
                .accessibilityLabel("Device actions")
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var controls: some View {
        HStack(spacing: 4) {
            if model.buttons.contains("back") {
                control("Back", icon: "undo-2") { model.press("back") }
            }
            if model.buttons.contains("home") {
                control("Home", icon: "house") { model.press("home") }
            }
            if model.buttons.contains("appSwitcher") {
                control("App switcher", icon: "smartphone") { model.press("appSwitcher") }
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 8)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.vertical, 8)
    }

    private func control(_ label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(lucide: icon, size: 18).frame(width: 52, height: 48).contentShape(.rect) }
            .accessibilityLabel(label)
    }

    private func pill(_ text: String, icon: String) -> some View {
        Label(text, lucideIcon: icon).font(.footnote.weight(.medium))
            .padding(.horizontal, 14).padding(.vertical, 8)
            .glassEffect(.regular, in: .capsule)
            .padding(.top, 8)
    }

    @ViewBuilder private var message: some View {
        let name = model.reference?.text("name") ?? "The device"
        switch model.phase {
        case .noReference:
            ContentUnavailableView(
                "No device", lucideIcon: "circle-alert", description: Text("This view does not point at a device."))
        case .finding, .starting, .streaming:
            VStack(spacing: 12) {
                ProgressView()
                Text(model.phase == .finding ? "Finding \(name)" : "Starting the screen of \(name)")
                    .font(.subheadline).foregroundStyle(MobileStyle.muted)
            }
        case .notOnMachine:
            ContentUnavailableView(
                "Not on this machine", lucideIcon: "smartphone",
                description: Text(
                    "\(name) with \(model.reference?.text("runtime") ?? "this runtime") "
                        + "is not installed on this machine."))
        case .listFailed(let problem), .failed(let problem):
            ContentUnavailableView {
                Label("Could not show \(name)", lucideIcon: "triangle-alert", iconSize: 48)
            } description: {
                Text(problem)
            } actions: {
                Button("Try again") { model.retry() }
            }
        case .stopped:
            ContentUnavailableView {
                Label("\(name) is stopped", lucideIcon: "smartphone", iconSize: 48)
            } description: {
                Text(
                    model.device?.text("kind") == "physical"
                        ? "Connect and unlock it, then it shows here." : "Start it to see its screen.")
            } actions: {
                if model.canBoot {
                    Button {
                        Task { await model.boot() }
                    } label: {
                        if model.booting { ProgressView() } else { Text("Start device") }
                    }
                    .buttonStyle(.glassProminent).tint(MobileStyle.accent)
                    .disabled(model.booting)
                }
            }
        case .noStream(let problem):
            ContentUnavailableView("No screen to show", lucideIcon: "monitor-off", description: Text(problem))
        case .unsupportedFormat:
            ContentUnavailableView(
                "Shown on the computer only", lucideIcon: "monitor-smartphone",
                description: Text(
                    "\(name) sends its screen as video, which this app does not show yet. Simulators show here."))
        case .offline:
            ContentUnavailableView(
                "Reconnecting to the machine", lucideIcon: "wifi-off",
                description: Text("The device shows again once the machine is back."))
        }
    }

    static func label(_ button: String) -> String {
        switch button {
        case "swipeHome": "Swipe home"
        case "appSwitcher": "App switcher"
        case "lock": "Lock"
        case "siri": "Siri"
        case "back": "Back"
        default: "Home"
        }
    }

    static func icon(_ button: String) -> String {
        switch button {
        case "swipeHome": "hand"
        case "appSwitcher": "smartphone"
        case "lock": "lock"
        case "siri": "mic"
        case "back": "undo-2"
        default: "house"
        }
    }
}

/// The device's screen, fitted to the page, that turns a finger into pointer input on the device.
private struct DeviceScreen: View {
    let image: UIImage
    let model: DeviceViewModel
    @State private var down = false

    var body: some View {
        GeometryReader { geometry in
            let screen = DeviceView.fitted(image.size, in: CGRect(origin: .zero, size: geometry.size))
            Image(uiImage: image)
                .resizable()
                .interpolation(.medium)
                .frame(width: screen.width, height: screen.height)
                .clipShape(.rect(cornerRadius: 18))
                .position(x: screen.midX, y: screen.midY)
                .gesture(
                    DragGesture(minimumDistance: 0, coordinateSpace: .local)
                        .onChanged { drag in
                            guard let position = DeviceView.position(of: drag.location, in: screen) else { return }
                            model.touch(down ? "move" : "down", at: position)
                            down = true
                        }
                        .onEnded { drag in
                            let position =
                                DeviceView.position(of: drag.location, in: screen)
                                ?? DeviceView.position(
                                    of: CGPoint(
                                        x: min(screen.maxX - 1, max(screen.minX, drag.location.x)),
                                        y: min(screen.maxY - 1, max(screen.minY, drag.location.y))), in: screen)
                            if down, let position { model.touch("up", at: position) }
                            down = false
                        },
                    including: model.takesInput ? .all : .none
                )
                .accessibilityLabel("Screen of the device")
        }
    }
}
