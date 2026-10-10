import Foundation
import Observation
import RuimtePulsar

@MainActor @Observable
public final class ImageSaveCoordinator {
    public private(set) var current: ImageSaveModel?
    public private(set) var opening = false
    @ObservationIgnored private let chatID: String
    @ObservationIgnored private let request: ImageSaveModel.Request
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var continuation: CheckedContinuation<String?, Never>?

    public init(chatID: String, request: @escaping ImageSaveModel.Request) {
        self.chatID = chatID
        self.request = request
    }

    public func open(attachmentID: String) async throws -> String? {
        guard !opening && current == nil else { return nil }
        generation += 1
        let id = generation
        opening = true
        defer { if generation == id { opening = false } }
        let root: JSONValue
        do {
            root = try await request(
                "chat.imageTarget", .object(["chatId": .string(chatID), "attachmentId": .string(attachmentID)]))
        } catch {
            guard generation == id else { return nil }
            throw error
        }
        guard generation == id else { return nil }
        try Task.checkCancellation()
        let model = try ImageSaveModel(chatID: chatID, attachmentID: attachmentID, root: root, request: request) {
            [weak self] path in self?.finish(id: id, path: path)
        }
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else {
                    continuation.resume(returning: nil)
                    return
                }
                self.continuation = continuation
                current = model
                opening = false
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(id: id, path: nil) }
        }
    }

    /// Answers a caller still waiting with nil and lets the sheet go, for a chat that leaves before the sheet closes.
    public func stop() {
        generation += 1
        current = nil
        opening = false
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: nil)
    }

    isolated deinit {
        continuation?.resume(returning: nil)
    }

    public func close() {
        guard current?.pending != true else { return }
        if let current {
            current.close()
        } else {
            generation += 1
            opening = false
        }
    }

    private func finish(id: Int, path: String?) {
        guard generation == id else { return }
        generation += 1
        current = nil
        opening = false
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: path)
    }
}
