import Foundation
import Testing

@testable import RuimtePulsar

struct PushCryptoTests {
    @Test func machineSummaryCountsAreIncludedInSignedBytes() throws {
        let push = try JSONValue.decode(
            Data(
                #"{"machineId":"machine","handle":"handle","id":"id","issuedAt":1,"expiresAt":2,"collapseId":"collapse","pushType":"liveactivity","activity":{"title":"Mac","phase":"needs-you","startedAt":1,"runningCount":2,"attentionCount":1}}"#
                    .utf8)
        )
        #expect(
            try PushSigning.message(push) == "pulsar-push-v1\n"
                + #"["machine","handle","id",1,2,"collapse","liveactivity","Mac","needs-you",1,2,1]"#)
    }

    @Test func replayClaimsAreAtomicAndExpire() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let ledger = PushReplayLedger(directory: folder)
        let accepted = await withTaskGroup(of: Bool.self) { group in
            for _ in 0..<8 {
                group.addTask {
                    do {
                        try ledger.claim(id: "one", expiresAt: 100, now: 1)
                        return true
                    } catch { return false }
                }
            }
            var count = 0
            for await claimed in group { if claimed { count += 1 } }
            return count
        }
        #expect(accepted == 1)
        #expect(throws: (any Error).self) { try ledger.claim(id: "one", expiresAt: 100, now: 2) }
        try ledger.claim(id: "two", expiresAt: 200, now: 101)
        let retained = try JSONDecoder().decode(
            [String: Double].self, from: Data(contentsOf: folder.appendingPathComponent("push-receipts.json")))
        #expect(retained == ["two": 200])
    }

    @Test func badgesCountNodesAcrossMachinesAndClearOnOpen() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let ledger = PushReplayLedger(directory: folder)
        let first = try PushReplayLedger.nodeKey(machineID: "one", nodeID: "same-node")
        let second = try PushReplayLedger.nodeKey(machineID: "two", nodeID: "same-node")
        #expect(try ledger.claim(id: "1", expiresAt: 100, now: 1, unseenNode: first) == 1)
        #expect(try ledger.claim(id: "2", expiresAt: 100, now: 2, unseenNode: first) == 1)
        #expect(try ledger.claim(id: "3", expiresAt: 100, now: 3, unseenNode: second) == 2)
        #expect(try ledger.attentionKeys() == [first, second])
        #expect(try ledger.clearAttention(node: first) == 1)
        #expect(try ledger.clearAttention() == 0)
    }

    @Test func corruptedReceiptsFailClosed() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        try Data("broken".utf8).write(to: folder.appendingPathComponent("push-receipts.json"))
        #expect(throws: (any Error).self) {
            try PushReplayLedger(directory: folder).claim(id: "one", expiresAt: 100, now: 1)
        }
    }

    @Test func decryptsTypeScriptFixtureAndRejectsChanges() throws {
        let fixture = try JSONValue.decode(
            Data(contentsOf: #require(Bundle.module.url(forResource: "wire", withExtension: "json"))))
        let sample = try #require(fixture["pushEncryption"])
        let push = try #require(sample["push"])
        let key = try PushDecryptionKey(
            rawRepresentation: #require(sample["privateKey"]?.stringValue.flatMap(Base64URL.decode)))
        let machineKey = try #require(sample["machinePublicKey"]?.stringValue)
        let handle = try #require(push["handle"]?.stringValue)
        let keys = ["machine-1": machineKey]
        let content = try key.decrypt(push, handle: handle, machinePublicKeys: keys, now: 2000)
        #expect(try JSONValue.decode(JSONEncoder().encode(content)) == sample["content"])
        for field in ["machineId", "id", "handle", "collapseId", "ciphertext", "ephemeralKey", "signature"] {
            var altered = try #require(push.objectValue)
            altered[field] = .string(String(repeating: "X", count: altered[field]?.stringValue?.count ?? 1))
            #expect(throws: (any Error).self) {
                try key.decrypt(.object(altered), handle: handle, machinePublicKeys: keys, now: 2000)
            }
        }
        #expect(throws: (any Error).self) {
            try key.decrypt(push, handle: handle, machinePublicKeys: keys, now: 121001)
        }
        #expect(
            try key.decrypt(push, handle: handle, machinePublicKeys: keys, now: 121001, allowExpiredRouting: true)
                .nodeId == "node-1")
        #expect(throws: (any Error).self) {
            try PushDecryptionKey().decrypt(push, handle: handle, machinePublicKeys: keys, now: 2000)
        }
        #expect(throws: (any Error).self) { try key.decrypt(push, handle: "other", machinePublicKeys: keys, now: 2000) }
        #expect(throws: (any Error).self) { try key.decrypt(push, handle: handle, machinePublicKeys: [:], now: 2000) }
    }
}
