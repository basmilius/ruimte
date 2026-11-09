import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

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
    static func matches(_ device: DeviceInfo, _ reference: StoredDeviceViewDevice) -> Bool {
        device.platform == reference.platform && device.kind == reference.kind && device.name == reference.name
            && device.runtime == reference.runtime
    }

    static func resolve(_ reference: StoredDeviceViewDevice, in devices: [DeviceInfo]) -> DeviceInfo? {
        devices.first { matches($0, reference) }
    }

    static func target(_ device: DeviceInfo) -> [String: JSONValue] {
        [
            "deviceId": .string(device.deviceId), "backendId": .string(device.backendId),
            "platform": .string(device.platform.rawValue),
        ]
    }

    /// The buttons the device announces that this version knows; a device that announces none, such as a physical
    /// iPhone, has an iPhone's.
    static func buttons(_ device: DeviceInfo) -> [String] {
        guard let announced = device.capabilities.buttons else { return iosButtons }
        return announced.filter(knownButtons.contains)
    }

    /// What a device in the list means for the page; `starting` for one that is booted and can be shown.
    static func phase(for device: DeviceInfo) -> DeviceViewPhase {
        switch device.state {
        case .booted:
            device.capabilities.stream
                ? .starting : .noStream(String(localized: "This machine cannot show this device's screen."))
        case .transitioning: .starting
        case .shutdown: .stopped
        }
    }

    static func canBoot(_ device: DeviceInfo) -> Bool {
        device.state == .shutdown && device.capabilities.boot
    }

    static func phase(forOpenError error: Error) -> DeviceViewPhase {
        if case MachineClientError.server(_, let message) = error {
            switch error.machineCode {
            case .deviceFormatUnsupported: return .unsupportedFormat
            case .deviceNotBooted: return .stopped
            case .deviceNotFound: return .notOnMachine
            case .deviceCaptureUnavailable, .platformUnavailable: return .noStream(message)
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
    let reference: StoredDeviceViewDevice?
    private(set) var phase: DeviceViewPhase
    private(set) var device: DeviceInfo?
    private(set) var frame: UIImage?
    private(set) var booting = false
    // A machine that takes `device.watch` says when the list changed; one from before it is read every two seconds
    // while the view waits and every five while it shows.
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.deviceFrame, as: DeviceFrameEvent.self) { [weak self] frame in self?.receive(frame) },
            .reread(.deviceChanged),
        ],
        watch: .area(.deviceWatch, gated: true),
        poll: { [weak self] in self?.phase == .streaming ? 5_000 : 2_000 },
        connection: { [weak self] connected in
            guard let self else { return }
            if connected {
                if phase == .offline { phase = .finding }
            } else {
                frames.reset()
                opened = nil
                if frame != nil || phase == .streaming { phase = .offline }
            }
        }, read: { [weak self] in await self?.refresh() })
    @ObservationIgnored private var opened: [String: JSONValue]?
    @ObservationIgnored private var lastSequence = -1
    @ObservationIgnored private let decode: DeviceFrameDecoder.Decode
    @ObservationIgnored private lazy var frames = DeviceFrameDecoder(decode: decode) { [weak self] image in
        guard let self, phase == .streaming || phase == .starting else { return }
        frame = image
        phase = .streaming
    }
    @ObservationIgnored private var lastMove = Date.distantPast
    @ObservationIgnored private var gestureFromBottom = false

    init(
        client: any MachineRequesting, reference: StoredDeviceViewDevice?,
        decode: @escaping DeviceFrameDecoder.Decode = DeviceFrameDecoder.image
    ) {
        self.client = client
        self.reference = reference
        self.decode = decode
        phase = reference == nil ? .noReference : .finding
    }

    var buttons: [String] { device.map(DeviceView.buttons) ?? [] }
    var takesInput: Bool { phase == .streaming && device?.capabilities.input == true }
    var canBoot: Bool { device.map(DeviceView.canBoot) ?? false }
    var canStop: Bool {
        device?.state == .booted && device?.capabilities.shutdown == true
    }
    var title: String {
        reference.map { "\($0.name) · \($0.runtime)" } ?? String(localized: "Device")
    }
    var tools: [String] { device.map(DeviceTools.tools) ?? [] }
    /// A hardware keyboard types on the device while its screen shows, as the desktop's does with the focus there.
    var takesKeys: Bool { takesInput && tools.contains("keyboard") }
    var canErase: Bool { device.map(DeviceTools.canErase) ?? false }
    private(set) var erasing = false

    func start() {
        guard reference != nil else { return }
        live.start()
    }

    func stop() {
        live.stop()
        detach()
    }

    func boot() async {
        guard let device, !booting else { return }
        booting = true
        defer { booting = false }
        do {
            self.device = try await client.request(.deviceBoot, payload: .object(DeviceView.target(device)))
                .decoded(as: DeviceInfo.self)
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
            self.device = try await client.request(.deviceShutdown, payload: .object(DeviceView.target(device)))
                .decoded(as: DeviceInfo.self)
            frame = nil
            phase = .stopped
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func retry() {
        frames.reset()
        opened = nil
        phase = .finding
        Task { await live.refresh() }
    }

    func press(_ button: String) { send(.object(["kind": .string("button"), "button": .string(button)])) }

    func key(_ phase: String, usage: Int) {
        guard takesKeys else { return }
        send(.object(["kind": .string("key"), "phase": .string(phase), "usage": .number(Double(usage))]))
    }

    /// ⌘V pastes this phone's clipboard through the device's, so accents and emoji arrive as they are.
    func paste() {
        guard let device, takesKeys, tools.contains("clipboard"),
            (client as? MachineClient)?.answers(.deviceClipboard) == true, let text = UIPasteboard.general.string
        else { return }
        var payload = DeviceView.target(device)
        payload["text"] = .string(text)
        payload["paste"] = .bool(true)
        Task { _ = try? await client.request(.deviceClipboard, payload: .object(payload)) }
    }

    func act(_ name: String) {
        guard let device else { return }
        Task { _ = try? await client.request(.deviceAction, payload: DeviceTools.action(device, name)) }
    }

    /// Erases a simulator or an emulator as the desktop does: a running one stops first, and a simulator starts
    /// again after, since an emulator starts again by itself.
    func erase() async {
        guard let device, canErase, !erasing else { return }
        erasing = true
        defer { erasing = false }
        let running = device.state == .booted
        do {
            if canStop {
                detach()
                frame = nil
                _ = try await client.request(.deviceShutdown, payload: .object(DeviceView.target(device)))
            }
            _ = try await client.request(.deviceAction, payload: DeviceTools.action(device, "erase"))
            if running && device.platform == .ios && device.capabilities.boot {
                _ = try await client.request(.deviceBoot, payload: .object(DeviceView.target(device)))
            }
            phase = .finding
            await refresh()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
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
        Task { _ = try? await client.request(.deviceInput, payload: .object(payload)) }
    }

    func refresh() async {
        guard let reference else { return }
        do {
            let result = try await client.request(.deviceList).decoded(as: DeviceListResult.self)
            guard let found = DeviceView.resolve(reference, in: result.devices) else {
                device = nil
                frame = nil
                detach()
                phase = .notOnMachine
                return
            }
            device = found
            let next = DeviceView.phase(for: found)
            guard found.state == .booted, next == .starting else {
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

    private func open(_ device: DeviceInfo) async {
        frames.reset()
        if phase != .streaming { phase = .starting }
        var payload = DeviceView.target(device)
        payload["stream"] = .string("events")
        payload["formats"] = .array([.string("jpeg")])
        do {
            let info = try await client.request(.deviceOpen, payload: .object(payload))
                .decoded(as: DeviceOpenResult.self)
            let opened = DeviceInfo(info)
            self.opened = DeviceView.target(opened)
            self.device = opened
            lastSequence = -1
            phase = .streaming
        } catch {
            phase = DeviceView.phase(forOpenError: error)
        }
    }

    private func detach() {
        frames.reset()
        guard let opened else { return }
        self.opened = nil
        Task { [client] in _ = try? await client.request(.deviceDetach, payload: .object(opened)) }
    }

    private func receive(_ frame: DeviceFrameEvent) {
        guard let opened, frame.deviceId == opened["deviceId"]?.stringValue,
            frame.backendId == opened["backendId"]?.stringValue
        else { return }
        let sequence = Int(frame.sequence)
        guard (frame.format ?? .jpeg) == .jpeg, sequence != lastSequence else { return }
        lastSequence = sequence
        frames.submit(frame.data)
    }
}

struct DeviceViewPage: View {
    @State private var model: DeviceViewModel
    @State private var showsTools = false
    @State private var confirmsErase = false

    init(client: any MachineRequesting, reference: StoredDeviceViewDevice?) {
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
                pill(String(localized: "Reconnecting to the machine"), icon: "wifi-off")
            } else if model.phase == .streaming && !model.takesInput {
                pill(String(localized: "Read-only preview"), icon: "eye")
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
                            Button(String(localized: "Rotate left"), lucideIcon: "rotate-ccw") {
                                model.rotate(left: true)
                            }
                            Button(String(localized: "Rotate right"), lucideIcon: "rotate-cw") {
                                model.rotate(left: false)
                            }
                            if model.tools.contains("shake") {
                                Button(String(localized: "Shake"), lucideIcon: "vibrate") { model.act("shake") }
                            }
                        }
                        if model.device != nil && !model.tools.isEmpty {
                            Button(String(localized: "Device tools"), lucideIcon: "sliders-horizontal") {
                                showsTools = true
                            }
                        }
                        Button(String(localized: "Reload"), lucideIcon: "refresh-cw") { model.retry() }
                    }
                    if model.canErase {
                        Button(String(localized: "Erase…"), lucideIcon: "eraser", role: .destructive) {
                            confirmsErase = true
                        }
                        .disabled(model.erasing)
                    }
                    if model.canStop {
                        Button(String(localized: "Stop device"), lucideIcon: "power", role: .destructive) {
                            Task { await model.shutdown() }
                        }
                    }
                } label: {
                    Image(lucide: "ellipsis")
                }
                .accessibilityLabel("Device actions")
            }
        }
        .sheet(isPresented: $showsTools) {
            if let device = model.device { DeviceToolsSheet(client: model.client, device: device) }
        }
        .alert(Text("Erase \(model.reference?.name ?? "")?"), isPresented: $confirmsErase) {
            Button(String(localized: "Erase"), role: .destructive) { Task { await model.erase() } }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text("Every app, setting and file on it goes, as on a new device. This cannot be undone.")
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var controls: some View {
        HStack(spacing: 4) {
            if model.buttons.contains("back") {
                control(DeviceViewPage.label("back"), icon: "undo-2") { model.press("back") }
            }
            if model.buttons.contains("home") {
                control(DeviceViewPage.label("home"), icon: "house") { model.press("home") }
            }
            if model.buttons.contains("appSwitcher") {
                control(DeviceViewPage.label("appSwitcher"), icon: "smartphone") { model.press("appSwitcher") }
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
        let name = model.reference?.name ?? String(localized: "The device")
        switch model.phase {
        case .noReference:
            ContentUnavailableView(
                String(localized: "No device"), lucideIcon: "circle-alert",
                description: Text("This view does not point at a device."))
        case .finding, .starting, .streaming:
            VStack(spacing: 12) {
                ProgressView()
                Text(model.phase == .finding ? "Finding \(name)" : "Starting the screen of \(name)")
                    .font(.subheadline).foregroundStyle(MobileStyle.muted)
            }
        case .notOnMachine:
            let runtime = model.reference?.runtime ?? String(localized: "this runtime")
            ContentUnavailableView(
                String(localized: "Not on this machine"), lucideIcon: "smartphone",
                description: Text("\(name) with \(runtime) is not installed on this machine."))
        case .listFailed(let problem), .failed(let problem):
            ContentUnavailableView {
                Label(String(localized: "Could not show \(name)"), lucideIcon: "triangle-alert", iconSize: 48)
            } description: {
                Text(problem)
            } actions: {
                Button("Try again") { model.retry() }
            }
        case .stopped:
            ContentUnavailableView {
                Label(String(localized: "\(name) is stopped"), lucideIcon: "smartphone", iconSize: 48)
            } description: {
                Text(
                    model.device?.kind == .physical
                        ? "Connect and unlock it, then it shows here." : "Start it to see its screen.")
            } actions: {
                if model.canBoot {
                    Button {
                        Task { await model.boot() }
                    } label: {
                        if model.booting { ProgressView() } else { Text("Start device") }
                    }
                    .buttonStyle(.mobileCapsuleProminent)
                    .disabled(model.booting)
                }
            }
        case .noStream(let problem):
            ContentUnavailableView(
                String(localized: "No screen to show"), lucideIcon: "monitor-off", description: Text(problem))
        case .unsupportedFormat:
            ContentUnavailableView(
                String(localized: "Shown on the machine only"), lucideIcon: "monitor-smartphone",
                description: Text(
                    "\(name) sends its screen as video, which this app does not show yet. Simulators show here."))
        case .offline:
            ContentUnavailableView(
                String(localized: "Reconnecting to the machine"), lucideIcon: "wifi-off",
                description: Text("The device shows again once the machine is back."))
        }
    }

    static func label(_ button: String) -> String {
        switch button {
        case "swipeHome": String(localized: "Swipe home", comment: "A button of a phone or tablet")
        case "appSwitcher": String(localized: "App switcher", comment: "A button of a phone or tablet")
        case "lock": String(localized: "Lock", comment: "A button of a phone or tablet")
        case "siri": "Siri"
        case "back": String(localized: "Back", comment: "A button of a phone or tablet")
        default: String(localized: "Home", comment: "A button of a phone or tablet")
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
            if model.takesKeys {
                DeviceKeyCatcher(model: model).frame(width: 1, height: 1).accessibilityHidden(true)
            }
        }
    }
}
