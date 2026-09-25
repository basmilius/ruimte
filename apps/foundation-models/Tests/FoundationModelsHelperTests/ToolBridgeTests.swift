import Testing
@testable import FoundationModelsHelper

@Test func deniedToolTerminatesAllPendingCallsAndCannotBecomeSuccessfulText() async throws {
    let frames = AsyncStream<Frame>.makeStream()
    let bridge = ToolBridge(send: { frames.continuation.yield($0) })
    await bridge.begin(turnID: "turn")
    var iterator = frames.stream.makeAsyncIterator()
    let first = Task { try await bridge.call(Frame(type: "tool.call", name: "read_file")) }
    let firstFrame = try #require(await iterator.next())
    let second = Task { try await bridge.call(Frame(type: "tool.call", name: "ask_user")) }
    _ = try #require(await iterator.next())
    await bridge.reply(id: firstFrame.id!, text: "No", outcome: .denied)
    await #expect(throws: ToolBridgeError.denied("No")) { try await first.value }
    await #expect(throws: ToolBridgeError.denied("No")) { try await second.value }
    await #expect(throws: ToolBridgeError.denied("No")) {
        try await bridge.call(Frame(type: "tool.call", name: "write_file"))
    }
    #expect(await bridge.calls == 2)
}

@Test func toolBudgetStopsBeforeThirteenthRequest() async throws {
    let frames = AsyncStream<Frame>.makeStream()
    let bridge = ToolBridge(send: { frames.continuation.yield($0) })
    await bridge.begin(turnID: "turn")
    var iterator = frames.stream.makeAsyncIterator()
    for _ in 0..<12 {
        let call = Task { try await bridge.call(Frame(type: "tool.call", name: "read_file")) }
        let frame = try #require(await iterator.next())
        await bridge.reply(id: frame.id!, text: "Read", outcome: .success)
        #expect(try await call.value == "Read")
    }
    await #expect(throws: ToolBridgeError.callLimit) {
        try await bridge.call(Frame(type: "tool.call", name: "read_file"))
    }
    #expect(await bridge.calls == 12)
}

@Test func questionBudgetIncludesNativeAndStructuredQuestions() async throws {
    let frames = AsyncStream<Frame>.makeStream()
    let bridge = ToolBridge(send: { frames.continuation.yield($0) })
    await bridge.begin(turnID: "turn")
    var iterator = frames.stream.makeAsyncIterator()
    for _ in 0..<3 {
        let call = Task { try await bridge.call(Frame(type: "tool.call", name: "ask_user")) }
        let frame = try #require(await iterator.next())
        await bridge.reply(id: frame.id!, text: "Answer", outcome: .success)
        _ = try await call.value
    }
    await #expect(throws: ToolBridgeError.questionLimit) {
        try await bridge.call(Frame(type: "tool.call", name: "ask_user"))
    }
}

@Test func cancellationAndLateRepliesCannotChangeTheNextTurn() async throws {
    let frames = AsyncStream<Frame>.makeStream()
    let bridge = ToolBridge(send: { frames.continuation.yield($0) })
    var iterator = frames.stream.makeAsyncIterator()
    await bridge.begin(turnID: "old")
    let old = Task { try await bridge.call(Frame(type: "tool.call", name: "read_file")) }
    let oldFrame = try #require(await iterator.next())
    old.cancel()
    await #expect(throws: CancellationError.self) { try await old.value }
    await bridge.begin(turnID: "new")
    let current = Task { try await bridge.call(Frame(type: "tool.call", name: "read_file")) }
    let currentFrame = try #require(await iterator.next())
    await bridge.reply(id: oldFrame.id!, text: "Late denial", outcome: .denied)
    await bridge.cancel(turnID: "old")
    await bridge.reply(id: currentFrame.id!, text: "Current result", outcome: .success)
    #expect(try await current.value == "Current result")
    #expect(await bridge.failure == nil)
}

@Test func failedToolIsNotReturnedAsSuccessfulModelContext() async throws {
    let frames = AsyncStream<Frame>.makeStream()
    let bridge = ToolBridge(send: { frames.continuation.yield($0) })
    await bridge.begin(turnID: "turn")
    let call = Task { try await bridge.call(Frame(type: "tool.call", name: "edit_file")) }
    var iterator = frames.stream.makeAsyncIterator()
    let frame = try #require(await iterator.next())
    await bridge.reply(id: frame.id!, text: "No unique match", outcome: .error)
    await #expect(throws: ToolBridgeError.failed("No unique match")) { try await call.value }
}

@Test func rejectedEditsAllowTwoCorrectionsWithoutHidingPriorEffects() async throws {
    let frames = AsyncStream<Frame>.makeStream()
    let bridge = ToolBridge(send: { frames.continuation.yield($0) })
    await bridge.begin(turnID: "turn")
    var iterator = frames.stream.makeAsyncIterator()
    for attempt in 1...3 {
        let call = Task { try await bridge.call(Frame(type: "tool.call", name: "edit_file")) }
        let frame = try #require(await iterator.next())
        await bridge.reply(id: frame.id!, text: "No file was changed.", outcome: .recoverableError)
        if attempt < 3 {
            #expect(try await call.value == "TOOL ERROR. No file was changed.")
            #expect(await bridge.failure == nil)
        } else {
            await #expect(throws: ToolBridgeError.correctionLimit) { try await call.value }
        }
        #expect(await bridge.hasPossibleEffects == (attempt == 3))
        if attempt == 2 {
            let write = Task { try await bridge.call(Frame(type: "tool.call", name: "write_file")) }
            let written = try #require(await iterator.next())
            await bridge.reply(id: written.id!, text: "Created", outcome: .success)
            _ = try await write.value
            #expect(await bridge.hasPossibleEffects)
        }
    }
}

@Test func onlySuccessfulEditOfTheSameFileResolvesARejectedEdit() async throws {
    let frames = AsyncStream<Frame>.makeStream()
    let bridge = ToolBridge(send: { frames.continuation.yield($0) })
    await bridge.begin(turnID: "turn")
    var iterator = frames.stream.makeAsyncIterator()
    for (name, path, outcome) in [
        ("edit_file", "planning.md", ToolOutcome.recoverableError),
        ("read_file", "planning.md", .success),
        ("edit_file", "other.md", .success),
        ("edit_file", "planning.md", .success)
    ] {
        let call = Task { try await bridge.call(Frame(type: "tool.call", name: name, path: path)) }
        let frame = try #require(await iterator.next())
        await bridge.reply(id: frame.id!, text: "result", outcome: outcome)
        _ = try await call.value
        #expect(await bridge.unresolvedEdits.isEmpty == (name == "edit_file" && path == "planning.md" && outcome == .success))
    }
    await bridge.begin(turnID: "next")
    #expect(await bridge.unresolvedEdits.isEmpty)
}
