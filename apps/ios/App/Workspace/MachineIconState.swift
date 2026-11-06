import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

@MainActor @Observable
final class MachineIconState {
    private(set) var icon: MachineIcon?
    /// Whether the machine may take up a chat that stopped on a limit on a clock, `resumeAtReset` in `endpoint.info`.
    /// Read beside the icon since both come from there.
    private(set) var resumeAtReset = false
    /// Whether the machine resolves the views and nodes a message points at with `#`, `viewReferences` in
    /// `endpoint.info`; without it a `#` reaches chats only.
    private(set) var viewReferences = false
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
        unsubscribe = client.subscribe(.endpointChanged) { [weak self] value in
            guard let self, connected, let event = try? value.decoded(as: EndpointChangedEvent.self) else { return }
            cancelRefresh()
            apply(event)
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
                    let answer = try await client.request(.endpointInfo)
                    guard !Task.isCancelled, self.connected, revision == operation else { return }
                    apply(try answer.decoded(as: EndpointInfo.self))
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

    /// An answer to `endpoint.info`, where an absent switch is off.
    private func apply(_ info: EndpointInfo) {
        resumeAtReset = info.resumeAtReset ?? false
        viewReferences = info.viewReferences == true
        switch info.icon {
        case .missing: break
        case .null: icon = nil
        case .value(let value): icon = value
        }
    }

    /// An event leaves out the switches it does not change.
    private func apply(_ event: EndpointChangedEvent) {
        if let resume = event.resumeAtReset { resumeAtReset = resume }
        icon = event.icon
    }

    isolated deinit {
        task?.cancel()
        unsubscribe?()
        unobserve?()
    }
}
