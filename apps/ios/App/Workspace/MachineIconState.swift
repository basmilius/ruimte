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
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var connected = false
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.endpointChanged, as: EndpointChangedEvent.self) { [weak self] event in
                guard let self, connected else { return }
                revision += 1
                apply(event)
            }
        ],
        connection: { [weak self] connected in
            self?.connected = connected
            self?.revision += 1
        }, read: { [weak self] in await self?.read() })

    init(client: any MachineRequesting, fallback: MachineIcon?) {
        self.client = client
        icon = fallback
    }

    func start() { live.start() }

    func stop() {
        connected = false
        revision += 1
        live.stop()
    }

    private func read() async {
        let operation = revision
        // An unavailable icon must not hide projects or change the connection's error state.
        guard let answer = try? await client.request(.endpointInfo),
            let info = try? answer.decoded(as: EndpointInfo.self), !Task.isCancelled, connected,
            revision == operation
        else { return }
        apply(info)
    }

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
}
