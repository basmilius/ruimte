import Foundation
import RuimtePulsar

struct DirectReceivePolicy: Sendable {
    let authenticated: Bool
    let deflating: Bool
}

enum DirectFrameFailure: Sendable, Equatable {
    case unreadable
    case tooLarge
    case unexpectedBinary
}

enum DirectFrameResult: Sendable, Equatable {
    case partial
    case text(String, units: Int, deflated: Bool)
    case binary(Data)
    case failure(DirectFrameFailure)
}

actor DirectFrameDecoder {
    private var text = FrameAssembler()
    private var binary = MarkedFrameAssembler.binary
    private var deflated = MarkedFrameAssembler.deflated
    private var closed = false

    func push(_ data: Data, isBinary: Bool, policy: DirectReceivePolicy) -> DirectFrameResult {
        guard !closed else { return .partial }
        if isBinary, binary.accepts(data) {
            guard policy.authenticated else { return .failure(.unexpectedBinary) }
            switch binary.push(data, maxBytes: WireConstants.bytesReplyMaxBytes) {
            case .partial: return .partial
            case .invalid: return .failure(.unreadable)
            case .frame(let frame): return .binary(frame)
            }
        }
        if isBinary, deflated.accepts(data) {
            guard policy.authenticated, policy.deflating else { return .failure(.unreadable) }
            // A UTF-16 unit takes at most three UTF-8 bytes, so this admits every frame the text lane takes.
            let limit = DirectFraming.authenticatedFrameChars * 3
            switch deflated.push(data, maxBytes: limit) {
            case .partial: return .partial
            case .invalid: return .failure(.unreadable)
            case .frame(let compressed):
                do {
                    let frame = try DirectFraming.inflate(compressed, maxBytes: limit)
                    return .text(frame, units: frame.utf16.count, deflated: true)
                } catch .tooLarge {
                    return .failure(.tooLarge)
                } catch {
                    return .failure(.unreadable)
                }
            }
        }
        guard let piece = String(data: data, encoding: .utf8) else { return .failure(.unreadable) }
        let limit = policy.authenticated ? DirectFraming.authenticatedFrameChars : DirectFraming.handshakeFrameChars
        switch text.push(piece, maxChars: limit) {
        case .partial: return .partial
        case .invalid:
            if case .tooLarge = text.failure { return .failure(.tooLarge) }
            return .failure(.unreadable)
        case .frame(let frame): return .text(frame, units: frame.utf16.count, deflated: false)
        }
    }

    func close() {
        closed = true
        reset()
    }

    func reset() {
        text = FrameAssembler()
        binary = .binary
        deflated = .deflated
    }
}

@MainActor final class DirectFrameInbox {
    private let decoder = DirectFrameDecoder()
    private let policy: () -> DirectReceivePolicy?
    private let received: (DirectFrameResult) -> Void
    private var incoming: Task<Void, Never>?
    private var closed = false

    init(policy: @escaping () -> DirectReceivePolicy?, received: @escaping (DirectFrameResult) -> Void) {
        self.policy = policy
        self.received = received
    }

    @discardableResult func push(_ data: Data, isBinary: Bool) -> Task<Void, Never> {
        let previous = incoming
        let decoder = decoder
        let task = Task.detached { [weak self] in
            await previous?.value
            // Delivery can accept the handshake, so policy must be read after the preceding delivery.
            guard !Task.isCancelled, let policy = await self?.currentPolicy() else { return }
            guard !Task.isCancelled else { return }
            let result = await decoder.push(data, isBinary: isBinary, policy: policy)
            guard !Task.isCancelled else { return }
            if case .partial = result { return }
            await self?.deliver(result)
        }
        incoming = task
        return task
    }

    func close() {
        guard !closed else { return }
        closed = true
        incoming?.cancel()
        incoming = nil
        let decoder = decoder
        Task { await decoder.close() }
    }

    private func currentPolicy() -> DirectReceivePolicy? {
        guard !closed else { return nil }
        let current = policy()
        // Reporting progress while taking policy can end the link.
        return closed ? nil : current
    }

    private func deliver(_ result: DirectFrameResult) {
        guard !closed else { return }
        received(result)
    }
}
