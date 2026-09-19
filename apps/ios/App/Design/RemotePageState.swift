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

    func load(_ operation: () async throws -> JSONValue) async {
        await read {
            let result = try await operation()
            try Task.checkCancellation()
            self.value = result
        }
    }

    /// One read by a surface that keeps the value itself. `loaded` says whether there is already something on screen,
    /// since only a first read shows a spinner.
    func read(loaded: Bool? = nil, _ operation: () async throws -> Void) async {
        loading = !(loaded ?? (value != nil))
        defer { loading = false }
        await settle(operation)
    }

    /// One action, refused while another is still running.
    func perform(_ operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        await settle(operation)
    }

    private func settle(_ operation: () async throws -> Void) async {
        do {
            try await operation()
            try Task.checkCancellation()
            problem = nil
        } catch is CancellationError {
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            problem = error.localizedDescription
        }
    }
}

@MainActor enum RemotePageLifecycle {
    static func run(
        client: any MachineRequesting, events: [String] = [],
        matches: @escaping @MainActor @Sendable (JSONValue) -> Bool = { _ in true },
        subscription: (() -> MachineSubscription)? = nil, start: @escaping () async throws -> Void = {},
        stop: @escaping () async -> Void = {}, load: @escaping () async -> Void
    ) async {
        var lease: MachineSubscription?
        let (stream, continuation) = AsyncStream<Bool>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let cancelConnection = client.observeConnection { connected in if connected { continuation.yield(true) } }
        let cancelEvents = events.map { event in
            client.subscribe(event) { if matches($0) { continuation.yield(false) } }
        }
        defer {
            cancelConnection()
            cancelEvents.forEach { $0() }
            continuation.finish()
            await withTaskCancellationShield {
                await lease?.release()
                await stop()
            }
        }
        for await connected in stream {
            if Task.isCancelled { break }
            if connected {
                try? await start()
                if lease == nil { lease = subscription?() }
                _ = try? await lease?.refresh()
            }
            await load()
        }
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
        if state.loading { MobileLoadingRow("Loading").frame(maxWidth: .infinity).padding() }
        if let problem = state.problem {
            VStack(alignment: .leading, spacing: 12) {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
                Button("Try again", action: retry)
            }.padding(.vertical, 8)
        }
    }
}
