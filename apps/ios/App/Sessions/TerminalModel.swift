import Foundation
import Observation
import RuimtePulsar
import RuimteTransport

@MainActor @Observable
final class TerminalModel {
    let client: any MachineRequesting
    let sessionID: String
    var connected = false
    var loading = false
    var exited = false
    var cols = 80
    var rows = 24
    var error: String?
    /// Ctrl from the key bar, waiting for the next key typed.
    var controlArmed = false
    @ObservationIgnored var render: ((String, Bool) -> Void)?
    @ObservationIgnored var resizeDisplay: ((Int, Int) -> Void)?
    @ObservationIgnored var applicationCursor: (() -> Bool)?
    @ObservationIgnored var toggleKeyboard: (() -> Void)?
    // Only the events and the link: the attach below hands over the screen, then output follows without a gap, which
    // no re-read of a resource does.
    @ObservationIgnored private lazy var live = LiveResource(
        client: client,
        events: [
            .apply(.sessionOutput, as: SessionOutputEvent.self) { [weak self] event in
                guard let self, event.sessionId == sessionID else { return }
                deliver(event.data, reset: false)
            },
            .apply(.sessionResync, as: SessionResyncEvent.self) { [weak self] event in
                guard let self, event.sessionId == sessionID else { return }
                deliver(event.screen, reset: true)
            },
            .apply(.sessionSize, as: SessionSizeEvent.self) { [weak self] event in
                guard let self, event.sessionId == sessionID else { return }
                follow(event)
            },
            .apply(.sessionExit, as: SessionExitEvent.self) { [weak self] event in
                guard let self, event.sessionId == sessionID else { return }
                exited = true
            },
            .apply(.sessionListChanged, raw: { [weak self] _ in Task { await self?.refreshInfo() } }),
        ],
        connection: { [weak self] available in
            guard let self else { return }
            connected = available
            if available {
                attach()
            } else {
                cancelWork()
                loading = false
                error = nil
            }
        })
    @ObservationIgnored private var attachTask: Task<Void, Never>?
    @ObservationIgnored private var writeTask: Task<Void, Never>?
    @ObservationIgnored private var queuedInput: [String] = []
    // The terminal view flushes output from its update, so a tracked buffer would invalidate that update with every
    // flush and SwiftUI would run it again without end.
    @ObservationIgnored private var pendingOutput: [(String, Bool)] = []
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var attachment: MachineAttachment?

    init(client: any MachineRequesting, sessionID: String) {
        self.client = client
        self.sessionID = sessionID
    }

    var usable: Bool { connected && !loading && !exited }

    func start() {
        guard !live.isStarted else { return }
        attachment = client.acquireAttachment(.session, id: sessionID)
        live.start()
    }

    func stop() {
        cancelWork()
        live.stop()
        render = nil
        resizeDisplay = nil
        applicationCursor = nil
        toggleKeyboard = nil
        let held = attachment
        attachment = nil
        Task { await held?.release() }
    }

    private func cancelWork() {
        generation += 1
        attachTask?.cancel()
        writeTask?.cancel()
        queuedInput.removeAll()
    }

    func target(_ values: [String: JSONValue] = [:]) -> JSONValue {
        .object(values.merging(["sessionId": .string(sessionID)], uniquingKeysWith: { _, target in target }))
    }

    func attach() {
        generation += 1
        let current = generation
        attachTask?.cancel()
        loading = true
        pendingOutput.removeAll()
        attachTask = Task { [weak self] in
            guard let self else { return }
            do {
                guard let attachment else { throw CancellationError() }
                _ = try await TerminalSnapshot.load(attachment: attachment, sessionID: sessionID) {
                    [weak self] payload in
                    guard let self, self.generation == current,
                        let snapshot = try? payload.decoded(as: SessionAttachResult.self)
                    else { return }
                    self.cols = Int(snapshot.cols)
                    self.rows = Int(snapshot.rows)
                    self.exited = snapshot.exited
                    self.resizeDisplay?(self.cols, self.rows)
                    self.pendingOutput = [(snapshot.screen, true)]
                    self.loading = false
                    self.flushOutput()
                    self.error = nil
                }
                guard !Task.isCancelled, generation == current else { return }
                await refreshInfo()
            } catch is CancellationError {} catch {
                guard generation == current else { return }
                loading = false
                self.error = error.localizedDescription
            }
        }
    }

    func refreshInfo() async {
        do {
            let result = try await client.request(.sessionList, payload: .object([:]))
                .decoded(as: SessionListResult.self)
            guard !Task.isCancelled, connected else { return }
            if let info = result.sessions.first(where: { $0.sessionId == sessionID }) {
                exited = info.exited
            }
        } catch { self.error = error.localizedDescription }
    }

    func follow(_ size: SessionSizeEvent) {
        cols = Int(size.cols)
        rows = Int(size.rows)
        resizeDisplay?(self.cols, self.rows)
    }

    func deliver(_ text: String, reset: Bool) {
        guard !loading else { return }
        if reset { pendingOutput.removeAll() }
        pendingOutput.append((text, reset))
        flushOutput()
    }

    func flushOutput() {
        guard !loading, let render else { return }
        let output = pendingOutput
        pendingOutput.removeAll()
        for (text, reset) in output { render(text, reset) }
    }

    func write(_ text: String) {
        guard usable else { return }
        queuedInput.append(text)
        guard writeTask == nil else { return }
        writeTask = Task {
            defer { writeTask = nil }
            // Keys typed during a write go out together, so a slow link costs a round trip per write, not per key.
            while !queuedInput.isEmpty, !Task.isCancelled {
                let text = queuedInput.joined()
                queuedInput.removeAll()
                do { _ = try await client.request(.sessionWrite, payload: target(["data": .string(text)])) } catch {
                    self.error = error.localizedDescription
                    queuedInput.removeAll()
                    return
                }
            }
        }
    }

    /// What the keyboard typed, with the Ctrl the key bar holds applied to its first key.
    func type(_ text: String) {
        guard controlArmed else {
            write(text)
            return
        }
        controlArmed = false
        write(TerminalKeys.control(text) ?? text)
    }

    func arrow(up: Bool) {
        write(TerminalKeys.arrow(up: up, applicationCursor: applicationCursor?() ?? false))
    }

    func clear() async {
        do { _ = try await client.request(.sessionClear, payload: target()) } catch {
            self.error = error.localizedDescription
        }
    }
}
