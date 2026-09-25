import Foundation
import FoundationModels
import Testing
@testable import FoundationModelsHelper

@Test(.enabled(if: ProcessInfo.processInfo.environment["RUIMTE_TEST_NATIVE_APPLE"] == "1"), .timeLimit(.minutes(1)))
func nativeSummaryPreservesSavedHistoryAndRestoresConversation() async throws {
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("ruimte-afm-native-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: home) }
    let store = try SessionStore(id: UUID().uuidString.lowercased(), home: home.path)
    let facts = ["The project color is violet.", "The launch day is Thursday.", "The project is called Lantern.", "The budget has not been confirmed."]
    let original = Transcript(entries: facts.flatMap { fact -> [Transcript.Entry] in
        [.prompt(.init(segments: [.text(.init(content: fact))])),
         .response(.init(assetIDs: [], segments: [.text(.init(content: "I will remember that."))]))]
    })
    struct Legacy: Encodable { let version = 1; let id: String; let transcript: Transcript }
    let file = store.folder.appendingPathComponent("\(store.id).json")
    try JSONEncoder().encode(Legacy(id: store.id, transcript: original)).write(to: file)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    let frames = AsyncStream<Frame>.makeStream()
    let output = Output(receive: { frames.continuation.yield($0) })
    let runner = Runner(store: store, output: output)
    try await runner.restore(required: true)
    var iterator = frames.stream.makeAsyncIterator()
    _ = await iterator.next()
    await runner.handle(Request(type: "compact", id: "compact", prompt: nil, output: nil, outcome: nil))
    var compacted = false
    while let frame = await iterator.next() {
        if frame.type == "compacted" { compacted = true; break }
        if frame.type == "done" { throw SessionStoreError(description: frame.text ?? "Compaction failed") }
    }
    #expect(compacted)
    struct Evidence: Decodable { let version: Int; let history: Transcript; let transcript: Transcript; let toolsetFingerprint: String }
    let saved = try JSONDecoder().decode(Evidence.self, from: Data(contentsOf: file))
    #expect(saved.version == 2)
    #expect(saved.history == original)
    #expect(ContextHistory.turnCount(Array(saved.transcript)) == 3)
    #expect(!saved.toolsetFingerprint.isEmpty)
    let summary = Array(saved.transcript).compactMap { entry -> String? in
        guard case .response(let response) = entry else { return nil }
        return response.segments.compactMap { segment -> String? in
            guard case .text(let text) = segment else { return nil }
            return text.content
        }.joined(separator: "\n")
    }.first ?? ""
    #expect(summary.lowercased().contains("violet"))
    #expect(summary.lowercased().contains("thursday"))
    print("Native summary: \(summary)")
    try ContextCompaction.validate(Array(saved.transcript))
    let restarted = Runner(store: store, output: output)
    try await restarted.restore(required: true)
    _ = await iterator.next()
    await restarted.handle(Request(type: "turn", id: "recall", prompt: "What project color and launch day did we agree? Reply briefly from memory. Do not use tools.", output: nil, outcome: nil))
    var text = ""
    var metrics: Frame?
    while let frame = await iterator.next() {
        if frame.type == "text.snapshot" { text = frame.text ?? "" }
        if frame.type == "metrics" { metrics = frame }
        if frame.type == "tool.call" {
            print("Unexpected recall tool: \(frame.name ?? "unknown")")
            await restarted.handle(Request(type: "tool.result", id: frame.id, prompt: nil, output: "This memory check needs no tools.", outcome: .denied))
        }
        if frame.type == "done" {
            #expect(frame.state == "done")
            break
        }
    }
    #expect(text.lowercased().contains("violet"))
    #expect(text.lowercased().contains("thursday"))
    #expect((metrics?.schemaTokens ?? 0) > 0)
    #expect((metrics?.contextTokens ?? 0) > 0)
    #expect(metrics?.toolCalls == 0)
    print("Native recall output: \(text)")
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["RUIMTE_TEST_NATIVE_APPLE"] == "1"), .timeLimit(.minutes(1)))
func nativeCompactionHandlesSchemaHeavyHistory() async throws {
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("ruimte-afm-compaction-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: home) }
    let store = try SessionStore(id: UUID().uuidString.lowercased(), home: home.path)
    let facts = ["The project color is violet. The launch day is Thursday."] + (1...23).map { "Status update \($0): there are no new decisions." }
    let original = Transcript(entries: facts.flatMap { fact -> [Transcript.Entry] in
        [.prompt(.init(segments: [.text(.init(content: fact))], responseFormat: .init(type: AssistantReply.self))),
         .response(.init(assetIDs: [], segments: [.text(.init(content: "Acknowledged."))]))]
    })
    let plan = try #require(try ContextCompaction(Array(original)))
    let oldSource = String(decoding: try JSONEncoder().encode(Transcript(entries: plan.removed)), as: UTF8.self)
    let oldTokens = try await SystemLanguageModel.default.tokenCount(for: oldSource)
    let newTokens = try await SystemLanguageModel.default.tokenCount(for: plan.summarySource())
    #expect(oldTokens + 768 > SystemLanguageModel.default.contextSize)
    #expect(newTokens + 768 < SystemLanguageModel.default.contextSize)
    struct Legacy: Encodable { let version = 1; let id: String; let transcript: Transcript }
    let file = store.folder.appendingPathComponent("\(store.id).json")
    try JSONEncoder().encode(Legacy(id: store.id, transcript: original)).write(to: file)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    let frames = AsyncStream<Frame>.makeStream()
    let runner = Runner(store: store, output: Output(receive: { frames.continuation.yield($0) }))
    try await runner.restore(required: true)
    var iterator = frames.stream.makeAsyncIterator()
    _ = await iterator.next()
    await runner.handle(Request(type: "compact", id: "compact", prompt: nil, output: nil, outcome: nil))
    while let frame = await iterator.next() {
        if frame.type == "compacted" { break }
        if frame.type == "done" { throw SessionStoreError(description: frame.text ?? "Compaction failed") }
    }
    struct Evidence: Decodable { let history: Transcript; let transcript: Transcript }
    let saved = try JSONDecoder().decode(Evidence.self, from: Data(contentsOf: file))
    #expect(saved.history == original)
    #expect(ContextHistory.turnCount(Array(saved.transcript)) == 3)
    try ContextCompaction.validate(Array(saved.transcript))
    print("Compaction source: \(oldTokens) serialized tokens -> \(newTokens) content tokens; original history preserved.")
}
