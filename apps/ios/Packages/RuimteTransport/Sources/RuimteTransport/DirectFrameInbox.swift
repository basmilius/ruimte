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

struct DirectPiece: Sendable {
    let data: Data
    let isBinary: Bool
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

    /// Every complete frame of these pieces in order, read under one policy.
    func push(_ pieces: [DirectPiece], policy: DirectReceivePolicy) -> [DirectFrameResult] {
        pieces.compactMap { piece in
            let result = push(piece.data, isBinary: piece.isBinary, policy: policy)
            if case .partial = result { return nil }
            return result
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
    private var waiting: [DirectPiece] = []
    private var draining: Task<Void, Never>?
    private var closed = false

    init(policy: @escaping () -> DirectReceivePolicy?, received: @escaping (DirectFrameResult) -> Void) {
        self.policy = policy
        self.received = received
    }

    /// The task ends once this piece is decoded and its frame, if it completed one, delivered.
    @discardableResult func push(_ data: Data, isBinary: Bool) -> Task<Void, Never> {
        guard !closed else { return Task {} }
        waiting.append(DirectPiece(data: data, isBinary: isBinary))
        if let draining { return draining }
        let task = Task<Void, Never> { [weak self] in
            await self?.drain()
        }
        draining = task
        return task
    }

    func close() {
        guard !closed else { return }
        closed = true
        waiting.removeAll()
        draining?.cancel()
        draining = nil
        let decoder = decoder
        Task { await decoder.close() }
    }

    /*
     * Takes every piece that waits in one turn of the main actor, so a busy main actor makes the batches
     * larger instead of the queue longer. A piece per turn would wait behind the chat's drawing twice and
     * fall further behind for as long as a reply streams.
     */
    private func drain() async {
        defer { draining = nil }
        while !closed, !waiting.isEmpty {
            guard let policy = currentPolicy() else { return }
            // Before the handshake a delivered frame can change the policy, so those pieces go one at a time.
            let batch: [DirectPiece]
            if policy.authenticated {
                batch = waiting
                waiting.removeAll()
            } else {
                batch = [waiting.removeFirst()]
            }
            let results = await decoder.push(batch, policy: policy)
            for result in results {
                guard !closed, !Task.isCancelled else { return }
                received(result)
            }
        }
    }

    private func currentPolicy() -> DirectReceivePolicy? {
        guard !closed else { return nil }
        let current = policy()
        // Reporting progress while taking policy can end the link.
        return closed ? nil : current
    }
}
