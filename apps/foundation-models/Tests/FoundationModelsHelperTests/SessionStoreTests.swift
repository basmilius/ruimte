import Foundation
import FoundationModels
import Testing
@testable import FoundationModelsHelper

private func temporaryHome() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("ruimte-fm-store-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
    return url
}

@Test func transcriptRoundTripIsVersionedPrivateAndLocked() throws {
    let home = try temporaryHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let id = UUID().uuidString.lowercased()
    let store = try SessionStore(id: id, home: home.path)
    #expect(try store.load(required: false) == nil)
    let transcript = Transcript(entries: [Transcript.Entry.instructions(.init(id: "instructions", segments: [], toolDefinitions: []))])
    try store.save(transcript)
    #expect(try store.load(required: true) == transcript)
    let file = store.folder.appendingPathComponent("\(id).json")
    let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
    #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    #expect(throws: (any Error).self) { try SessionStore(id: id, home: home.path) }
    #expect(try FileManager.default.contentsOfDirectory(atPath: store.folder.path).filter { $0.hasSuffix(".tmp") }.isEmpty)
}

@Test func missingOrCorruptResumeNeverBecomesANewConversation() throws {
    let home = try temporaryHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let id = UUID().uuidString.lowercased()
    let store = try SessionStore(id: id, home: home.path)
    #expect(throws: (any Error).self) { try store.load(required: true) }
    let file = store.folder.appendingPathComponent("\(id).json")
    try Data("{not valid json}".utf8).write(to: file)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    #expect(throws: (any Error).self) { try store.load(required: true) }
}

@Test func sessionPathsRejectTraversalAndSymlinks() throws {
    let home = try temporaryHome()
    defer { try? FileManager.default.removeItem(at: home) }
    #expect(throws: (any Error).self) { try SessionStore(id: "../../escape", home: home.path) }
    let id = UUID().uuidString.lowercased()
    let store = try SessionStore(id: id, home: home.path)
    let target = home.appendingPathComponent("outside.json")
    try Data("{}".utf8).write(to: target)
    try FileManager.default.createSymbolicLink(at: store.folder.appendingPathComponent("\(id).json"), withDestinationURL: target)
    #expect(throws: (any Error).self) { try store.load(required: true) }
}

@Test func checkpointsRetainOriginalHistoryAndInterruptedTurnEvidence() throws {
    let home = try temporaryHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let store = try SessionStore(id: UUID().uuidString.lowercased(), home: home.path)
    let active = Transcript(entries: [])
    let original = Transcript(entries: [.prompt(.init(segments: [.text(.init(content: "Original request"))]))])
    try store.save(active, history: original, toolsetFingerprint: "trusted-tools", interrupted: true)
    #expect(try store.load(required: true, toolsetFingerprint: "trusted-tools") == active)
    #expect(store.history == original)
    #expect(store.interrupted)
    #expect(throws: (any Error).self) { try store.load(required: true, toolsetFingerprint: "changed-tools") }
    #expect(try store.load(required: true, toolsetFingerprint: "trusted-tools") == active)
    try store.save(active, history: original, toolsetFingerprint: "trusted-tools")
    _ = try store.load(required: true, toolsetFingerprint: "trusted-tools")
    #expect(!store.interrupted)
    let file = store.folder.appendingPathComponent("\(store.id).json")
    var record = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    record.removeValue(forKey: "toolsetFingerprint")
    try JSONSerialization.data(withJSONObject: record).write(to: file)
    #expect(throws: (any Error).self) { try store.load(required: true, toolsetFingerprint: "trusted-tools") }
}

@Test func legacyCheckpointMigratesWithoutDroppingTheConversation() throws {
    let home = try temporaryHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let id = UUID().uuidString.lowercased()
    let store = try SessionStore(id: id, home: home.path)
    let original = Transcript(entries: [.prompt(.init(segments: [.text(.init(content: "Legacy request"))]))])
    struct Legacy: Encodable { let version: Int; let id: String; let transcript: Transcript }
    let file = store.folder.appendingPathComponent("\(id).json")
    try JSONEncoder().encode(Legacy(version: 1, id: id, transcript: original)).write(to: file)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    #expect(try store.load(required: true, toolsetFingerprint: "current-tools") == original)
    #expect(store.history == original)
    try store.save(original, history: store.history, toolsetFingerprint: "current-tools")
    #expect(try store.load(required: true, toolsetFingerprint: "current-tools") == original)
}

@Test func oversizedCheckpointDoesNotReplaceThePreviousOne() throws {
    let home = try temporaryHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let store = try SessionStore(id: UUID().uuidString.lowercased(), home: home.path)
    let original = Transcript(entries: [])
    try store.save(original)
    let oversized = Transcript(entries: [.prompt(.init(segments: [.text(.init(content: String(repeating: "x", count: 2_100_000)))]))])
    #expect(throws: (any Error).self) { try store.save(original, history: oversized) }
    #expect(try store.load(required: true) == original)
}
