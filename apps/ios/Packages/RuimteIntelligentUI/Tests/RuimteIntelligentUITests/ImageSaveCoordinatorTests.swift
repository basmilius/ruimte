import Foundation
import Observation
import RuimtePulsar
import Testing

@testable import RuimteIntelligentUI

private let coordinatorRoot: JSONValue = .object([
    "folder": .string("/project"), "projectName": .string("Project"), "name": .string("image.png"),
    "exists": .bool(false), "revision": .null,
])

private actor SaveCoordinatorGate<Value: Sendable> {
    private var value: Value?
    private var waiting: [CheckedContinuation<Value, Never>] = []
    func wait() async -> Value {
        if let value { return value }
        return await withCheckedContinuation { waiting.append($0) }
    }
    func release(_ value: Value) {
        self.value = value
        for continuation in waiting { continuation.resume(returning: value) }
        waiting.removeAll()
    }
}

@MainActor struct ImageSaveCoordinatorTests {
    @Test func aCanceledCallerOrAStoppedChatIsAnsweredWithNil() async throws {
        let coordinator = ImageSaveCoordinator(chatID: "chat") { _, _ in coordinatorRoot }
        let appeared = observingPresentation(coordinator)
        let opened = Task { try await coordinator.open(attachmentID: "image") }
        _ = await appeared.wait()
        opened.cancel()
        #expect(try await opened.value == nil)
        #expect(coordinator.current == nil)
        let again = observingPresentation(coordinator)
        let another = Task { try await coordinator.open(attachmentID: "image") }
        _ = await again.wait()
        coordinator.stop()
        #expect(try await another.value == nil)
        #expect(coordinator.current == nil)
    }

    @Test func cancellingTheSheetCompletesItsCallerOnceAndAllowsAnotherImage() async throws {
        var calls: [JSONValue] = []
        let coordinator = ImageSaveCoordinator(chatID: "original-chat") { _, payload in
            calls.append(payload)
            return coordinatorRoot
        }
        let appeared = observingPresentation(coordinator)
        let opened = Task { try await coordinator.open(attachmentID: "first-image") }
        _ = await appeared.wait()
        #expect(coordinator.current != nil)
        #expect(!coordinator.opening)
        #expect(try await coordinator.open(attachmentID: "duplicate") == nil)
        #expect(calls == [.object(["chatId": .string("original-chat"), "attachmentId": .string("first-image")])])
        let old = coordinator.current!
        coordinator.close()
        #expect(try await opened.value == nil)
        #expect(coordinator.current == nil)
        let anotherAppearance = observingPresentation(coordinator)
        let another = Task { try await coordinator.open(attachmentID: "second-image") }
        _ = await anotherAppearance.wait()
        old.close()
        #expect(coordinator.current != nil)
        coordinator.close()
        #expect(try await another.value == nil)
        #expect(calls.count == 2)
    }

    @Test func leavingWhileTheTargetLoadsCannotPresentItsLateResultOverAnotherRequest() async throws {
        let began = SaveCoordinatorGate<Bool>()
        let finish = SaveCoordinatorGate<JSONValue>()
        let coordinator = ImageSaveCoordinator(chatID: "chat") { _, payload in
            if payload["attachmentId"] == .string("old-image") {
                await began.release(true)
                return await finish.wait()
            }
            return coordinatorRoot
        }
        let old = Task { try await coordinator.open(attachmentID: "old-image") }
        _ = await began.wait()
        #expect(coordinator.opening)
        coordinator.close()
        let appeared = observingPresentation(coordinator)
        let new = Task { try await coordinator.open(attachmentID: "new-image") }
        _ = await appeared.wait()
        let presented = coordinator.current
        await finish.release(coordinatorRoot)
        #expect(try await old.value == nil)
        #expect(coordinator.current === presented)
        coordinator.close()
        #expect(try await new.value == nil)
    }

    @Test func aPendingSaveSurvivesTheRowsAndScreensClosingAndCompletesTheOriginalCaller() async throws {
        let began = SaveCoordinatorGate<Bool>()
        let finish = SaveCoordinatorGate<JSONValue>()
        var write: JSONValue?
        let coordinator = ImageSaveCoordinator(chatID: "chat") { type, payload in
            if type == "chat.saveImage" {
                write = payload
                await began.release(true)
                return await finish.wait()
            }
            return coordinatorRoot
        }
        let appeared = observingPresentation(coordinator)
        let opened = Task { try await coordinator.open(attachmentID: "image") }
        _ = await appeared.wait()
        let model = coordinator.current!
        await model.check()
        let saving = Task { await model.save() }
        _ = await began.wait()
        coordinator.close()
        #expect(coordinator.current === model)
        #expect(model.pending)
        #expect(write?["chatId"] == .string("chat"))
        #expect(write?["attachmentId"] == .string("image"))
        await finish.release(.object(["path": .string("/project/image.png")]))
        await saving.value
        #expect(try await opened.value == "/project/image.png")
        #expect(coordinator.current == nil)
        #expect(!coordinator.opening)
    }

    @Test func anOpeningFailureDoesNotLeaveTheHostBusy() async throws {
        struct Failure: Error {}
        var fail = true
        let coordinator = ImageSaveCoordinator(chatID: "chat") { _, _ in
            if fail { throw Failure() }
            return coordinatorRoot
        }
        await #expect(throws: Failure.self) { try await coordinator.open(attachmentID: "image") }
        #expect(!coordinator.opening)
        #expect(coordinator.current == nil)
        fail = false
        let appeared = observingPresentation(coordinator)
        let opened = Task { try await coordinator.open(attachmentID: "image") }
        _ = await appeared.wait()
        coordinator.close()
        #expect(try await opened.value == nil)
    }

    private func observingPresentation(_ coordinator: ImageSaveCoordinator) -> SaveCoordinatorGate<Bool> {
        let appeared = SaveCoordinatorGate<Bool>()
        withObservationTracking {
            _ = coordinator.current
        } onChange: {
            Task { @MainActor in await appeared.release(true) }
        }
        return appeared
    }
}
