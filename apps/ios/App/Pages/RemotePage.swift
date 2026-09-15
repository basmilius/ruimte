import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

@MainActor @Observable final class RemotePageState {
    var value: JSONValue?
    var problem: String?
    var loading = false
    var busy = false

    func load(_ operation: () async throws -> JSONValue) async {
        loading = value == nil
        defer { loading = false }
        do {
            let result = try await operation()
            try Task.checkCancellation()
            value = result
            problem = nil
        } catch is CancellationError {} catch { problem = error.localizedDescription }
    }

    func perform(_ operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await operation()
            problem = nil
        } catch is CancellationError {} catch { problem = error.localizedDescription }
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
            Task {
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

struct RemotePageStatus: View {
    let state: RemotePageState
    let retry: () -> Void
    var body: some View {
        if state.loading { ProgressView("Loading").frame(maxWidth: .infinity).padding() }
        if let problem = state.problem {
            VStack(alignment: .leading, spacing: 12) {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
                Button("Try again", action: retry)
            }.padding(.vertical, 8)
        }
    }
}

func mobileByteCount(_ value: Double?) -> String {
    guard let value, value.isFinite, value >= 0, value < Double(Int64.max) else { return "Unavailable" }
    return ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .file)
}
