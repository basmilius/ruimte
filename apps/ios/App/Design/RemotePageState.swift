import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The loading and error cycle of one surface, and the only place in the app that writes one. Three rules hold
/// wherever it is used: the first read shows a spinner while a reread keeps what is on screen, a read that succeeds
/// clears the reason the last one failed, and an attempt that was cancelled leaves nothing behind, since a person who
/// walked away from a page has no error to read.
@MainActor @Observable final class RemotePageState {
    /// The JSON of a page that reads one resource. A surface with a value of its own keeps that itself and reaches
    /// for `read` instead of `load`.
    var value: JSONValue?
    var problem: String?
    var loading = false
    /// An action a person started; what it came from stays disabled until it settles.
    var busy = false

    /// Counts reads, so a read that a newer one overtook writes nothing at all: not the value, not the spinner and
    /// not the reason it failed. Actions are serialized by `busy` instead and stay out of this.
    @ObservationIgnored private var reads = 0

    func load(_ operation: () async throws -> JSONValue) async {
        await read { stillTheLatest in
            let result = try await operation()
            try stillTheLatest()
            self.value = result
        }
    }

    /// One read by a surface that keeps the value itself. `loaded` says whether there is already something on screen,
    /// since only a first read shows a spinner. The closure is handed the check to make before it writes anything:
    /// it throws once a newer read has started, which counts as a cancellation.
    func read(
        loaded: Bool? = nil, _ operation: (_ stillTheLatest: @MainActor () throws -> Void) async throws -> Void
    ) async {
        reads += 1
        let attempt = reads
        loading = !(loaded ?? (value != nil))
        defer { if attempt == reads { loading = false } }
        await settle(attempt: attempt) {
            try await operation {
                try Task.checkCancellation()
                guard attempt == self.reads else { throw CancellationError() }
            }
        }
    }

    /// One action, refused while another is still running.
    func perform(_ operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        await settle(attempt: nil, operation)
    }

    private func settle(attempt: Int?, _ operation: () async throws -> Void) async {
        do {
            try await operation()
            try Task.checkCancellation()
            guard attempt == nil || attempt == reads else { return }
            problem = nil
        } catch is CancellationError {
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            guard attempt == nil || attempt == reads else { return }
            problem = error.localizedDescription
        }
    }
}

@MainActor enum RemotePageLifecycle {
    static func run(
        client: any MachineRequesting, events: [WireEvent] = [],
        matches: @escaping @MainActor @Sendable (JSONValue) -> Bool = { _ in true },
        watch: (@MainActor () -> LiveWatch)? = nil, start: @escaping @MainActor () async throws -> Void = {},
        stop: @escaping @MainActor () async -> Void = {}, load: @escaping @MainActor () async -> Void
    ) async {
        let live = LiveResource(
            client: client, events: events.map { .reread($0, rejected: false, where: matches) }, watch: watch?(),
            prepare: { try? await start() }, read: load)
        await live.run()
        await withTaskCancellationShield { await stop() }
    }

    /// A test on an event as its generated type; a payload that does not decode matches nothing.
    static func typed<Event: Decodable>(
        _ type: Event.Type, _ matches: @escaping @MainActor @Sendable (Event) -> Bool
    ) -> @MainActor @Sendable (JSONValue) -> Bool {
        { payload in (try? payload.decoded(as: type)).map(matches) ?? false }
    }
}

/// The spinner of a surface that is reading, with the one thing VoiceOver needs beside it: what is being read. Where
/// it sits and how much room it takes stays the surface's own business, so a call site adds its own frame.
struct MobileLoadingRow: View {
    let label: String

    init(_ label: String) {
        self.label = label
    }

    var body: some View {
        ProgressView().accessibilityLabel(label)
    }
}

struct RemotePageStatus: View {
    let state: RemotePageState
    let retry: () -> Void
    var body: some View {
        if state.loading { MobileLoadingRow(String(localized: "Loading")).frame(maxWidth: .infinity).padding() }
        if let problem = state.problem {
            VStack(alignment: .leading, spacing: 12) {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(MobileStyle.statusError)
                Button("Try again", action: retry)
            }.padding(.vertical, 8)
        }
    }
}
