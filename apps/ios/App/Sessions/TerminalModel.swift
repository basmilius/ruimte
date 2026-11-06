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
    @ObservationIgnored private var unsubscribe: [() -> Void] = []
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

    /// Whether the session takes keys now.
    var usable: Bool { connected && !loading && !exited }

    func start() {
        guard unsubscribe.isEmpty else { return }
        attachment = client.acquireAttachment(.session, id: sessionID)
        for eventName in [WireEvent]([.sessionOutput, .sessionResync, .sessionSize, .sessionExit]) {
            unsubscribe.append(
                client.subscribe(eventName) { [weak self] payload in
                    guard let self, payload["sessionId"]?.stringValue == sessionID else { return }
                    switch eventName {
                    case .sessionOutput: deliver(payload["data"]?.stringValue ?? "", reset: false)
                    case .sessionResync: deliver(payload["screen"]?.stringValue ?? "", reset: true)
                    case .sessionSize: follow(payload)
                    default: exited = true
                    }
                })
        }
        unsubscribe.append(
            client.subscribe(.sessionListChanged) { [weak self] _ in Task { await self?.refreshInfo() } })
        unsubscribe.append(
            client.observeConnection { [weak self] available in
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
    }

    func stop() {
        cancelWork()
        unsubscribe.forEach { $0() }
        unsubscribe.removeAll()
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
                    [weak self] snapshot in
                    guard let self, self.generation == current else { return }
                    self.cols = Int(snapshot["cols"]?.numberValue ?? 80)
                    self.rows = Int(snapshot["rows"]?.numberValue ?? 24)
                    self.exited = snapshot["exited"]?.boolValue ?? false
                    self.resizeDisplay?(self.cols, self.rows)
                    self.pendingOutput = [(snapshot["screen"]?.stringValue ?? "", true)]
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
            guard !Task.isCancelled, connected else { return }
            if let info = result["sessions"]?.arrayValue?.first(where: { $0["sessionId"]?.stringValue == sessionID }) {
                exited = info["exited"]?.boolValue ?? exited
            }
        } catch { self.error = error.localizedDescription }
    }

    func follow(_ size: JSONValue) {
        guard let cols = size["cols"]?.numberValue, let rows = size["rows"]?.numberValue else { return }
        self.cols = Int(cols)
        self.rows = Int(rows)
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
