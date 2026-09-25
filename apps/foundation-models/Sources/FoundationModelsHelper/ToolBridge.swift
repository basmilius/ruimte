import Foundation

enum ToolOutcome: String, Decodable, Sendable {
    case success, error, denied
    case recoverableError = "recoverable_error"
}

enum ToolBridgeError: Error, Equatable, CustomStringConvertible {
    case denied(String)
    case failed(String)
    case callLimit
    case questionLimit
    case correctionLimit

    var description: String {
        switch self {
        case .denied(let reason), .failed(let reason): reason
        case .callLimit: "The turn reached its limit of 12 tool calls. No further tools were executed."
        case .questionLimit: "The turn reached its limit of three questions. No further questions were opened."
        case .correctionLimit: "Three edits were rejected without changing their files. The turn stopped; review the tool errors before continuing."
        }
    }

    var isDenied: Bool {
        if case .denied = self { return true }
        return false
    }
}

actor ToolBridge {
    private let send: @Sendable (Frame) async -> Void
    private var turnID: String?
    private var pending: [String: CheckedContinuation<String, Error>] = [:]
    private var cancelled = false
    private(set) var calls = 0
    private var questions = 0
    private var corrections = 0
    private var editPaths: [String: String] = [:]
    private(set) var unresolvedEdits = Set<String>()
    private var possibleEffects = Set<String>()
    private(set) var failure: ToolBridgeError?

    var hasPossibleEffects: Bool { !possibleEffects.isEmpty }

    init(send: @escaping @Sendable (Frame) async -> Void) {
        self.send = send
    }

    func begin(turnID: String) {
        cancel()
        self.turnID = turnID
        cancelled = false
        calls = 0
        questions = 0
        corrections = 0
        editPaths.removeAll()
        unresolvedEdits.removeAll()
        possibleEffects.removeAll()
        failure = nil
    }

    func call(_ frame: Frame) async throws -> String {
        try Task.checkCancellation()
        if let failure { throw failure }
        guard !cancelled, let turnID else { throw CancellationError() }
        guard calls < 12 else { throw stop(.callLimit) }
        if frame.name == "ask_user" {
            guard questions < 3 else { throw stop(.questionLimit) }
            questions += 1
        }
        calls += 1
        let id = "\(turnID)-tool-\(calls)"
        if frame.name == "edit_file", let path = frame.path { editPaths[id] = path }
        if ["edit_file", "write_file", "run_command", "mcp_call"].contains(frame.name) {
            possibleEffects.insert(id)
        }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                pending[id] = continuation
                Task { await deliver(frame, id: id) }
            }
        } onCancel: {
            Task { await self.cancel(turnID: turnID) }
        }
    }

    private func deliver(_ frame: Frame, id: String) async {
        guard pending[id] != nil, !cancelled, failure == nil else { return }
        var request = frame
        request.id = id
        await send(request)
    }

    func reply(id: String, text: String, outcome: ToolOutcome) {
        guard let continuation = pending.removeValue(forKey: id) else { return }
        let editPath = editPaths.removeValue(forKey: id)
        switch outcome {
        case .success:
            if let editPath { unresolvedEdits.remove(editPath) }
            continuation.resume(returning: text)
        case .recoverableError:
            if let editPath { unresolvedEdits.insert(editPath) }
            possibleEffects.remove(id)
            corrections += 1
            if corrections >= 3 {
                continuation.resume(throwing: stop(.correctionLimit))
            } else {
                continuation.resume(returning: "TOOL ERROR. \(text)")
            }
        case .denied:
            possibleEffects.remove(id)
            continuation.resume(throwing: stop(.denied(text)))
        case .error: continuation.resume(throwing: stop(.failed(text)))
        }
    }

    @discardableResult private func stop(_ error: ToolBridgeError) -> ToolBridgeError {
        failure = failure ?? error
        let waiting = pending
        pending.removeAll()
        for continuation in waiting.values { continuation.resume(throwing: failure!) }
        return failure!
    }

    func cancel(turnID: String? = nil) {
        if let turnID, self.turnID != turnID { return }
        cancelled = true
        let waiting = pending
        pending.removeAll()
        for continuation in waiting.values { continuation.resume(throwing: CancellationError()) }
    }
}
