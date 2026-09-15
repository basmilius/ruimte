import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

@MainActor @Observable
final class MachineIconState {
    private(set) var icon: MachineIcon?
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private var unsubscribe: (() -> Void)?
    @ObservationIgnored private var unobserve: (() -> Void)?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var connected = false

    init(client: any MachineRequesting, fallback: MachineIcon?) {
        self.client = client
        icon = fallback
    }

    func start() {
        guard unobserve == nil else { return }
        unsubscribe = client.subscribe("endpoint.changed") { [weak self] value in
            guard let self, connected,
                let endpoint = try? WireEvent.endpointChanged.validatePayload(value)
            else { return }
            cancelRefresh()
            apply(endpoint)
        }
        unobserve = client.observeConnection { [weak self] connected in
            guard let self else { return }
            self.connected = connected
            cancelRefresh()
            guard connected else { return }
            let operation = revision
            task = Task { [weak self] in
                guard let self else { return }
                do {
                    let endpoint = try await client.request("endpoint.info", payload: .object([:]))
                    guard !Task.isCancelled, self.connected, revision == operation else { return }
                    apply(try WireRequest.endpointInfo.validateResult(endpoint))
                } catch {
                    // An unavailable icon must not hide projects or change the connection's error state.
                }
            }
        }
    }

    func stop() {
        connected = false
        cancelRefresh()
        unsubscribe?()
        unobserve?()
        unsubscribe = nil
        unobserve = nil
    }

    private func cancelRefresh() {
        revision += 1
        task?.cancel()
        task = nil
    }

    private func apply(_ endpoint: JSONValue) {
        guard let value = endpoint["icon"] else { return }
        if value == .null {
            icon = nil
        } else if let data = try? value.encoded(), let decoded = try? JSONDecoder().decode(MachineIcon.self, from: data)
        {
            icon = decoded
        }
    }

    isolated deinit {
        task?.cancel()
        unsubscribe?()
        unobserve?()
    }
}
