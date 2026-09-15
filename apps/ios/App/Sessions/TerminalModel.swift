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
    var approvals: [JSONValue] = []
    var error: String?
    @ObservationIgnored var render: ((String, Bool) -> Void)?
    @ObservationIgnored var resizeDisplay: ((Int, Int) -> Void)?
    private var unsubscribe: [() -> Void] = []
    private var attachTask: Task<Void, Never>?
    private var writeTask: Task<Void, Never>?
    private var queuedInput: [String] = []
    private var pendingOutput: [(String, Bool)] = []
    private var generation = 0
    @ObservationIgnored private var attachment: MachineAttachment?

    init(client: any MachineRequesting, sessionID: String) {
        self.client = client
        self.sessionID = sessionID
    }

    func start() {
        guard unsubscribe.isEmpty else { return }
        attachment = client.acquireAttachment("session", id: sessionID)
        for eventName in ["session.output", "session.resync", "session.exit", "session.approvals"] {
            unsubscribe.append(
                client.subscribe(eventName) { [weak self] payload in
                    guard let self, payload["sessionId"]?.stringValue == sessionID else { return }
                    switch eventName {
                    case "session.output": deliver(payload["data"]?.stringValue ?? "", reset: false)
                    case "session.resync": deliver(payload["screen"]?.stringValue ?? "", reset: true)
                    case "session.exit": exited = true
                    default: approvals = payload["approvals"]?.arrayValue ?? []
                    }
                })
        }
        unsubscribe.append(
            client.subscribe("session.list-changed") { [weak self] _ in Task { await self?.refreshInfo() } })
        unsubscribe.append(
            client.observeConnection { [weak self] available in
                guard let self else { return }
                connected = available
                if available {
                    attach()
                } else {
                    generation += 1
                    attachTask?.cancel()
                    writeTask?.cancel()
                    queuedInput.removeAll()
                    loading = false
                    error = "Connection lost. The terminal will reload when the machine reconnects."
                }
            })
    }

    func stop() {
        generation += 1
        attachTask?.cancel()
        writeTask?.cancel()
        queuedInput.removeAll()
        unsubscribe.forEach { $0() }
        unsubscribe.removeAll()
        render = nil
        resizeDisplay = nil
        let held = attachment
        attachment = nil
        Task { await held?.release() }
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
                _ = try await attachment.snapshot(payload: target(["follow": .bool(true)])) { [weak self] snapshot in
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
            let result = try await client.request("session.list", payload: .object([:]))
            guard !Task.isCancelled, connected else { return }
            if let info = result["sessions"]?.arrayValue?.first(where: { $0["sessionId"]?.stringValue == sessionID }) {
                cols = Int(info["cols"]?.numberValue ?? Double(cols))
                rows = Int(info["rows"]?.numberValue ?? Double(rows))
                approvals = info["approvals"]?.arrayValue ?? []
                exited = info["exited"]?.boolValue ?? exited
                resizeDisplay?(cols, rows)
            }
        } catch { self.error = error.localizedDescription }
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
        guard connected, !loading, !exited else { return }
        queuedInput.append(text)
        guard writeTask == nil else { return }
        writeTask = Task {
            defer { writeTask = nil }
            while !queuedInput.isEmpty, !Task.isCancelled {
                let text = queuedInput.removeFirst()
                do { _ = try await client.request("session.write", payload: target(["data": .string(text)])) } catch {
                    self.error = error.localizedDescription
                    queuedInput.removeAll()
                    return
                }
            }
        }
    }

    func clear() async {
        do { _ = try await client.request("session.clear", payload: target()) } catch {
            self.error = error.localizedDescription
        }
    }

    func answer(_ request: JSONValue, choice: JSONValue) async {
        do {
            let result = try await client.request(
                "agent.answerApproval",
                payload: target([
                    "requestId": request["requestId"] ?? .null, "choiceId": choice["id"] ?? .null,
                ]))
            if result["accepted"]?.boolValue != true { error = "This request was already answered or has expired." }
            await refreshInfo()
        } catch { self.error = error.localizedDescription }
    }
}
