import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit

/// The picture of one running device, read-only: frames over `device.open` with `stream: events`, never input. Only
/// JPEG is asked for, which an iOS simulator streams; a device that streams video answers
/// `device-format-unsupported` and shows its picture in its view instead.
@MainActor @Observable
final class MachineDevicePreview {
    private(set) var image: UIImage?
    /// Why there is no picture, once the machine said so.
    private(set) var unavailable: String?
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private let device: MachineDevice
    @ObservationIgnored private var unsubscribe: (() -> Void)?
    @ObservationIgnored private let now: () -> TimeInterval
    @ObservationIgnored private let decode: DeviceFrameDecoder.Decode
    @ObservationIgnored private var lastAccepted: TimeInterval?
    @ObservationIgnored private lazy var frames = DeviceFrameDecoder(decode: decode) { [weak self] in self?.image = $0 }
    @ObservationIgnored private var opened = false

    /// A preview is a glance, so it accepts at most a few frames a second whatever the device sends.
    private static let frameGap: TimeInterval = 0.25

    init(
        client: any MachineRequesting, device: MachineDevice,
        now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
        decode: @escaping DeviceFrameDecoder.Decode = DeviceFrameDecoder.image
    ) {
        self.client = client
        self.device = device
        self.now = now
        self.decode = decode
    }

    func start() async {
        guard unsubscribe == nil else { return }
        lastAccepted = nil
        let deviceID = device.deviceID
        let backendID = device.backendID
        unsubscribe = client.subscribe(.deviceFrame) { [weak self] frame in
            guard frame.text("deviceId") == deviceID, frame.text("backendId") == backendID else { return }
            self?.draw(frame)
        }
        do {
            _ = try await client.request(
                .deviceOpen,
                payload: device.target.setting("stream", .string("events")).setting(
                    "formats", .array([.string("jpeg")])))
            opened = true
        } catch {
            if case .server(let code, _) = error as? MachineClientError, code == "device-format-unsupported" {
                unavailable = String(localized: "Open it as a view to see its screen.")
            } else {
                unavailable = error.localizedDescription
            }
        }
    }

    func stop() {
        frames.reset()
        unsubscribe?()
        unsubscribe = nil
        guard opened else { return }
        opened = false
        let client = client
        let target = device.target
        Task { _ = try? await client.request(.deviceDetach, payload: target) }
    }

    private func draw(_ frame: JSONValue) {
        guard unsubscribe != nil, frame.text("format", fallback: "jpeg") == "jpeg" else { return }
        let instant = now()
        guard lastAccepted.map({ instant - $0 >= Self.frameGap }) ?? true else { return }
        lastAccepted = instant
        frames.submit(frame.text("data"))
    }
}

@MainActor final class DeviceFrameDecoder {
    typealias Decode = @Sendable (String) async -> UIImage?

    private let decode: Decode
    private let show: @MainActor (UIImage) -> Void
    private var task: Task<Void, Never>?
    private var pending: String?
    private var generation = 0

    init(decode: @escaping Decode = DeviceFrameDecoder.image, show: @escaping @MainActor (UIImage) -> Void) {
        self.decode = decode
        self.show = show
    }

    nonisolated static func image(_ encoded: String) async -> UIImage? {
        await Task.detached(priority: .userInitiated) {
            guard let data = Data(base64Encoded: encoded), let image = UIImage(data: data) else { return nil }
            return image.preparingForDisplay() ?? image
        }.value
    }

    func submit(_ encoded: String) {
        guard task == nil else {
            pending = encoded
            return
        }
        let generation = self.generation
        let decode = self.decode
        task = Task { [weak self] in
            let image = Task.isCancelled ? nil : await decode(encoded)
            self?.finish(image, generation: generation)
        }
    }

    func reset() {
        generation += 1
        pending = nil
        task?.cancel()
    }

    private func finish(_ image: UIImage?, generation: Int) {
        if generation == self.generation, let image { show(image) }
        task = nil
        if let next = pending {
            pending = nil
            submit(next)
        }
    }
}
