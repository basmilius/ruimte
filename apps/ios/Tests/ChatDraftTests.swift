import Foundation
import XCTest

#if canImport(Ruimte)
    @testable import Ruimte
#else
    @testable import ComposerChecks
#endif

final class ChatDraftTests: XCTestCase {
    @MainActor func testRestoresCompleteDraftAndScopesItToMachine() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let draft = ChatComposition(machineID: "first", chatID: "chat", root: root)
        draft.text = "Read @src/App.swift with $review 🌍"
        draft.mentions = ["src/App.swift"]
        draft.skills = ["review"]
        draft.chats = [ChatDraftReference(id: "other", title: "Design")]
        draft.selection = NSRange(location: 5, length: 4)
        draft.deliveryUncertain = true
        let id = try XCTUnwrap(draft.reserve("note.txt"))
        await draft.finishImport(id, data: Data("Contents".utf8), name: "note.txt", mime: "text/plain")
        await draft.flush()

        let restored = ChatComposition(machineID: "first", chatID: "chat", root: root)
        XCTAssertEqual(restored.record, draft.record)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(restored.uploads.first).url), Data("Contents".utf8))
        XCTAssertTrue(ChatComposition(machineID: "second", chatID: "chat", root: root).text.isEmpty)
        XCTAssertNil(draft.storageProblem)
    }

    @MainActor func testMigratesLegacyTextOnlyAfterSuccessfulSave() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer {
            try? FileManager.default.removeItem(at: root)
            defaults.removePersistentDomain(forName: suite)
        }
        defaults.set("Unsent message", forKey: "ruimte.chat.draft.legacy")
        let draft = ChatComposition(machineID: "machine", chatID: "legacy", root: root, defaults: defaults)
        XCTAssertEqual(draft.text, "Unsent message")
        XCTAssertTrue(draft.mentions.isEmpty)
        await draft.flush()
        XCTAssertNil(defaults.string(forKey: "ruimte.chat.draft.legacy"))
        XCTAssertEqual(
            ChatComposition(machineID: "machine", chatID: "legacy", root: root, defaults: defaults).text,
            "Unsent message")
    }

    @MainActor func testLateImportAfterRemovalCannotReappear() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let draft = ChatComposition(machineID: "machine", chatID: "chat", root: root)
        let id = try XCTUnwrap(draft.reserve("photo.png"))
        draft.imports.removeAll()
        await draft.finishImport(id, data: Data([1, 2, 3]), name: "photo.png", mime: "image/png")
        XCTAssertTrue(draft.uploads.isEmpty)
        XCTAssertFalse(draft.importing)
    }

    @MainActor func testAttachmentLimitsIncludePendingImportsAndActualBytes() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let draft = ChatComposition(machineID: "machine", chatID: "chat", root: root)
        for index in 0..<8 { XCTAssertNotNil(draft.reserve("File \(index)")) }
        XCTAssertNil(draft.reserve("Ninth"))
        draft.imports = []
        let first = try XCTUnwrap(draft.reserve("exact.bin"))
        await draft.finishImport(
            first, data: Data(repeating: 1, count: ChatDraftLimits.bytes), name: "exact.bin",
            mime: "application/octet-stream")
        XCTAssertEqual(draft.uploads.count, 1)
        let next = try XCTUnwrap(draft.reserve("extra.bin"))
        await draft.finishImport(next, data: Data([1]), name: "extra.bin", mime: "application/octet-stream")
        XCTAssertEqual(draft.uploads.count, 1)
        XCTAssertNotNil(draft.imports.first?.error)
        XCTAssertNil(draft.validation)
    }

    @MainActor func testTakingBackMergesInsteadOfOverwritingNewWork() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let draft = ChatComposition(machineID: "machine", chatID: "chat", root: root)
        draft.text = "New thought"
        draft.mentions = ["new.swift"]
        try draft.takeBack(
            ChatDraftRecord(text: "Earlier thought", mentions: ["old.swift"], skills: ["review"]), uploads: [])
        XCTAssertEqual(draft.text, "Earlier thought\n\nNew thought")
        XCTAssertEqual(Set(draft.mentions), ["old.swift", "new.swift"])
        XCTAssertEqual(draft.skills, ["review"])
        await draft.flush()
        XCTAssertEqual(try draft.files.read()?.text, draft.text)
    }

    func testOlderSaveCannotOverwriteNewerDraft() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let files = ChatDraftFiles(machineID: "machine", chatID: "chat", root: root)
        try await files.save(ChatDraftRecord(text: "New"), revision: 2)
        try await files.save(ChatDraftRecord(text: "Old"), revision: 1)
        XCTAssertEqual(try files.read()?.text, "New")
    }

    @MainActor func testUnreadableDraftIsPreservedBeforeSavingNewWork() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let files = ChatDraftFiles(machineID: "machine", chatID: "chat", root: root)
        try FileManager.default.createDirectory(at: files.directory, withIntermediateDirectories: true)
        let broken = Data("Unreadable draft".utf8)
        try broken.write(to: files.directory.appendingPathComponent("draft.json"))
        let draft = ChatComposition(machineID: "machine", chatID: "chat", root: root)
        XCTAssertTrue(draft.restoreFailed)
        draft.text = "New work"
        let id = try XCTUnwrap(draft.reserve("note.txt"))
        await draft.finishImport(id, data: Data("Note".utf8), name: "note.txt", mime: "text/plain")
        XCTAssertEqual(try Data(contentsOf: files.directory.appendingPathComponent("draft.json")), broken)
        await draft.recoverStorage()
        XCTAssertNil(draft.storageProblem)
        XCTAssertFalse(draft.restoreFailed)
        let restored = ChatComposition(machineID: "machine", chatID: "chat", root: root)
        XCTAssertEqual(restored.text, "New work")
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(restored.uploads.first).url), Data("Note".utf8))
        let backup = try XCTUnwrap(
            FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first {
                $0.lastPathComponent.contains("-recovered-")
            })
        XCTAssertEqual(try Data(contentsOf: backup.appendingPathComponent("draft.json")), broken)
    }

    func testSuggestionReplacesQueryAndPreservesUnicodeSelection() throws {
        let text = "🌍 Read @App"
        let range = NSRange(location: (text as NSString).length, length: 0)
        XCTAssertEqual(ChatDraftSyntax.query(in: text, selection: range)?.text, "App")
        let result = ChatDraftSyntax.insertion(text: text, selection: range, kind: "@", value: "src/App.swift")
        XCTAssertEqual(result.text, "🌍 Read @src/App.swift ")
        XCTAssertEqual(result.selection.location, (result.text as NSString).length)
        XCTAssertEqual(
            ChatDraftSyntax.tokens(in: result.text, mentions: ["src/App.swift"], skills: []).map(\.value),
            ["src/App.swift"])
    }

    func testSuggestionDoesNotOpenInCodeOrInTheMiddleOfAWord() {
        for text in ["`@file", "```swift\n@file", "mail@file", "Use /stop"] {
            XCTAssertNil(
                ChatDraftSyntax.query(in: text, selection: NSRange(location: (text as NSString).length, length: 0)),
                text)
        }
        let text = "$review"
        XCTAssertEqual(ChatDraftSyntax.query(in: text, selection: NSRange(location: text.count, length: 0))?.kind, "$")
    }

    @MainActor func testPromptLengthMatchesUTF16WireClientRule() async {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let draft = ChatComposition(machineID: "machine", chatID: "chat", root: root)
        draft.text = String(repeating: "🌍", count: 60_000)
        XCTAssertNil(draft.validation)
        draft.text += "a"
        XCTAssertNotNil(draft.validation)
        await draft.flush()
    }
}
