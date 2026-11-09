import Foundation
import RuimtePulsar

@testable import RuimteTransport

/// Runs nothing on its own; `advance` fires everything set so far.
@MainActor final class FakeScheduler: TransportScheduling {
    var pending: [UUID: @MainActor () -> Void] = [:]
    var delays: [Double] = []
    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void {
        let id = UUID()
        delays.append(milliseconds)
        pending[id] = action
        return { self.pending.removeValue(forKey: id) }
    }
    func advance() {
        let actions = Array(pending.values)
        pending.removeAll()
        for action in actions { action() }
    }
}

@MainActor final class FakeSignalSocket: SignalSocket {
    var received: ((String) -> Void)?
    var failed: ((Error) -> Void)?
    var writes: [JSONValue] = []
    var closed = false
    func start() {}
    func send(_ text: String) { writes.append(try! JSONValue.decode(Data(text.utf8))) }
    func close() {
        closed = true
        received = nil
        failed = nil
    }
    func receive(_ frame: JSONValue) throws { received?(try wireText(frame)) }
}

/// A link that closes the way a real one does: by saying so to its events.
@MainActor final class FakeLink: MachineLink {
    let events: LinkEvents
    var closes = 0
    var onSend: (String) throws -> Void = { _ in }
    init(events: LinkEvents) { self.events = events }
    func send(_ text: String) throws { try onSend(text) }
    func close() {
        closes += 1
        events.closed(nil)
    }
}

@MainActor final class FakeLinks {
    private(set) var all: [FakeLink] = []
    var last: FakeLink { all[all.count - 1] }

    func open(_ events: LinkEvents) -> any MachineLink {
        let link = FakeLink(events: events)
        all.append(link)
        return link
    }
}

extension LinkEvents {
    static var ignored: LinkEvents { LinkEvents(opened: {}, message: { _ in }, closed: { _ in }) }
}
