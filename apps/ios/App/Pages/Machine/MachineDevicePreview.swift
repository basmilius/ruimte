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
    @ObservationIgnored private var lastDrawn = ContinuousClock.now - .seconds(1)
    @ObservationIgnored private var opened = false

    /// A preview is a glance, so it draws at most a few frames a second whatever the device sends.
    private static let frameGap = Duration.milliseconds(250)

    init(client: any MachineRequesting, device: MachineDevice) {
        self.client = client
        self.device = device
    }

    func start() async {
        guard unsubscribe == nil else { return }
        let deviceID = device.deviceID
        let backendID = device.backendID
        unsubscribe = client.subscribe(WireEvent.deviceFrame.rawValue) { [weak self] frame in
            guard frame.text("deviceId") == deviceID, frame.text("backendId") == backendID else { return }
            self?.draw(frame)
        }
        do {
            _ = try await client.request(
                WireRequest.deviceOpen.rawValue,
                payload: device.target.setting("stream", .string("events")).setting(
                    "formats", .array([.string("jpeg")])))
            opened = true
        } catch {
            if case .server(let code, _) = error as? MachineClientError, code == "device-format-unsupported" {
                unavailable = String(localized: "Its picture shows when you open it as a view.")
            } else {
                unavailable = error.localizedDescription
            }
        }
    }

    func stop() {
        unsubscribe?()
        unsubscribe = nil
        guard opened else { return }
        opened = false
        let client = client
        let target = device.target
        Task { _ = try? await client.request(WireRequest.deviceDetach.rawValue, payload: target) }
    }

    private func draw(_ frame: JSONValue) {
        guard frame["format"]?.stringValue ?? "jpeg" == "jpeg" else { return }
        let now = ContinuousClock.now
        guard now - lastDrawn >= Self.frameGap, let data = Data(base64Encoded: frame.text("data")),
            let picture = UIImage(data: data)
        else { return }
        lastDrawn = now
        image = picture
    }
}
