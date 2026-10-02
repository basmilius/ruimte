import AVFoundation
import Foundation
import RuimtePulsar
import Testing

@testable import RuimteTransport

/// Serves `bytes` the way `bytes.read` does and counts what it was asked.
@MainActor private final class MediaMachine: MachineRequesting {
    var bytes: Data
    var version = "1-1"
    var asked: [(offset: Int, length: Int)] = []
    // How many of the next requests are refused.
    var refuse = 0
    // How many of the next requests fail on a dropped connection, which is back at the second look unless it stays down.
    var disconnects = 0
    var staysDown = false
    private var connection: [Bool] = []
    init(size: Int) { bytes = Data((0..<size).map { UInt8($0 % 251) }) }
    init(bytes: Data) { self.bytes = bytes }
    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        let offset = Int(payload["offset"]!.numberValue!)
        let length = Int(payload["length"]!.numberValue!)
        asked.append((offset, length))
        if disconnects > 0 {
            disconnects -= 1
            connection = staysDown ? [false, false] : [false, true]
            throw MachineClientError.disconnected
        }
        if refuse > 0 {
            refuse -= 1
            throw MachineClientError.server(code: "busy", message: "Try again")
        }
        guard offset <= bytes.count else { throw MachineClientError.server(code: "bad-offset", message: "Past the end") }
        let slice = bytes.subdata(in: offset..<min(offset + length, bytes.count))
        return .object([
            "mime": .string("video/mp4"), "size": .number(Double(bytes.count)), "version": .string(version),
            "offset": .number(Double(offset)), "data": .string(slice.base64EncodedString()),
        ])
    }
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
    func observeConnection(_ handler: @escaping @MainActor @Sendable (Bool) -> Void) -> () -> Void {
        handler(connection.isEmpty ? true : connection.removeFirst())
        return {}
    }
}

@MainActor struct MachineMediaTests {
    private func read(
        _ source: MachineMediaSource, offset: Int, length: Int?, onPiece: (Data) -> Void = { _ in }
    ) async throws -> (info: MachineMediaInfo?, data: Data) {
        var info: MachineMediaInfo?
        var data = Data()
        try await source.read(offset: offset, length: length, info: { info = $0 }) {
            data.append($0)
            onPiece($0)
        }
        return (info, data)
    }

    @Test func aClosedRangeIsReadExactlyInPieces() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8)
        let result = try await read(source, offset: 10, length: 20)
        #expect(result.data == machine.bytes.subdata(in: 10..<30))
        #expect(result.info == MachineMediaInfo(mime: "video/mp4", size: 100, version: "1-1"))
        #expect(machine.asked.map(\.offset) == [8, 16, 24])
        #expect(machine.asked.map(\.length) == [8, 8, 8])
    }

    @Test func overlappingReadsShareThePiecesTheyHave() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8)
        let first = try await read(source, offset: 0, length: 40)
        let again = try await read(source, offset: 12, length: 20)
        #expect(first.data == machine.bytes.subdata(in: 0..<40))
        #expect(again.data == machine.bytes.subdata(in: 12..<32))
        #expect(machine.asked.map(\.offset) == [0, 8, 16, 24, 32])
    }

    @Test func aPieceThatFailedOnADroppedConnectionIsAskedAgainOnTheNextOne() async throws {
        let machine = MediaMachine(size: 100)
        machine.disconnects = 1
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8)
        let result = try await read(source, offset: 0, length: 16)
        #expect(result.data == machine.bytes.subdata(in: 0..<16))
        #expect(machine.asked.map(\.offset) == [0, 0, 8])
    }

    @Test func aConnectionThatStaysDownFailsTheRead() async throws {
        let machine = MediaMachine(size: 100)
        machine.disconnects = 1
        machine.staysDown = true
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8, reconnectWaitMs: 0)
        await #expect(throws: MachineClientError.disconnected) {
            _ = try await read(source, offset: 0, length: 8)
        }
    }

    @Test func theSpoolGoesWithItsSource() async throws {
        let machine = MediaMachine(size: 100)
        var source: MachineMediaSource? = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8)
        _ = try await read(source!, offset: 0, length: 32)
        let url = try #require(source?.spoolURL)
        #expect(FileManager.default.fileExists(atPath: url.path()))
        source = nil
        #expect(!FileManager.default.fileExists(atPath: url.path()))
    }

    @Test func theSourceReadsAheadOfThePlayerOnItsOwn() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8, ahead: 2, readAheadPieces: 4)
        _ = try await read(source, offset: 0, length: 16)
        for _ in 0..<20 { await Task.yield() }
        #expect(machine.asked.map(\.offset) == [0, 8, 16, 24, 32, 40])
        let later = try await read(source, offset: 24, length: 24)
        #expect(later.data == machine.bytes.subdata(in: 24..<48))
        #expect(Set(machine.asked.map(\.offset)).count == machine.asked.count)
    }

    @Test func aFileThatChangedStopsReadingAhead() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8, ahead: 3, readAheadPieces: .max)
        _ = try await read(source, offset: 0, length: 16)
        machine.version = "2-2"
        for _ in 0..<2_000 { await Task.yield() }
        #expect(machine.asked.count <= 13 + 3)
    }

    @Test func aRefusedPieceStopsReadingAhead() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8, ahead: 3, readAheadPieces: .max)
        _ = try await read(source, offset: 0, length: 16)
        machine.refuse = .max
        for _ in 0..<2_000 { await Task.yield() }
        #expect(machine.asked.count <= 13 + 3)
    }

    @Test func aPieceAReadBringsInStartsReadingAheadAgain() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8, ahead: 1, readAheadPieces: .max)
        _ = try await read(source, offset: 0, length: 8)
        machine.refuse = 1
        await #expect(throws: MachineClientError.server(code: "busy", message: "Try again")) {
            _ = try await read(source, offset: 8, length: 8)
        }
        for _ in 0..<200 { await Task.yield() }
        #expect(machine.asked.map(\.offset) == [0, 8])
        let result = try await read(source, offset: 8, length: 8)
        #expect(result.data == machine.bytes.subdata(in: 8..<16))
        for _ in 0..<200 { await Task.yield() }
        #expect(Set(machine.asked.map(\.offset)) == Set(stride(from: 0, to: 100, by: 8)))
    }

    @Test func aCancelledSourceAsksNothingMoreAndGoes() async throws {
        let machine = MediaMachine(size: 1_000)
        var source: MachineMediaSource? = MachineMediaSource(
            client: machine, path: "/v.mp4", chunkBytes: 8, ahead: 3, readAheadPieces: .max)
        _ = try await read(try #require(source), offset: 0, length: 16)
        weak let gone = source
        source?.cancel()
        let asked = machine.asked.count
        source = nil
        for _ in 0..<200 { await Task.yield() }
        #expect(machine.asked.count == asked)
        #expect(gone == nil)
    }

    @Test func aSourceNobodyHoldsStopsReadingAhead() async throws {
        let machine = MediaMachine(size: 1_000)
        var source: MachineMediaSource? = MachineMediaSource(
            client: machine, path: "/v.mp4", chunkBytes: 8, ahead: 3, readAheadPieces: .max)
        _ = try await read(try #require(source), offset: 0, length: 16)
        weak let gone = source
        source = nil
        for _ in 0..<2_000 { await Task.yield() }
        #expect(gone == nil)
        #expect(machine.asked.count < 20)
    }

    @Test func aReadOnACancelledSourceFails() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8)
        source.cancel()
        await #expect(throws: CancellationError.self) {
            _ = try await read(source, offset: 0, length: 8)
        }
        #expect(machine.asked.isEmpty)
    }

    @Test func aPieceThatFailedIsAskedAgain() async throws {
        let machine = MediaMachine(size: 100)
        machine.refuse = 1
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8)
        await #expect(throws: MachineClientError.server(code: "busy", message: "Try again")) {
            _ = try await read(source, offset: 0, length: 8)
        }
        let result = try await read(source, offset: 0, length: 8)
        #expect(result.data == machine.bytes.subdata(in: 0..<8))
    }

    @Test func aReadToTheEndReadsTheRestOfTheFile() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8)
        let result = try await read(source, offset: 50, length: nil)
        #expect(result.data == machine.bytes.subdata(in: 50..<100))
    }

    @Test func aRangeEndsWithTheFile() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8)
        let result = try await read(source, offset: 90, length: 50)
        #expect(result.data == machine.bytes.subdata(in: 90..<100))
        let atEnd = try await read(source, offset: 100, length: 10)
        #expect(atEnd.data.isEmpty)
        #expect(atEnd.info?.size == 100)
    }

    @Test func piecesAreAskedAheadButNoFurther() async throws {
        let machine = MediaMachine(size: 1_000)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 10, ahead: 2)
        var askedWhenFirstArrived: Int?
        _ = try await read(source, offset: 0, length: 100) { _ in
            if askedWhenFirstArrived == nil { askedWhenFirstArrived = machine.asked.count }
        }
        #expect(askedWhenFirstArrived == 1)
        #expect(machine.asked.count == 10)
    }

    @Test func aFileThatChangesHalfwayFailsTheRead() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8, ahead: 1)
        await #expect(throws: MachineClientError.invalid("The file changed while it played.")) {
            _ = try await read(source, offset: 0, length: 40) { _ in machine.version = "2-2" }
        }
    }

    @Test func aFileThatChangedBetweenReadsFailsTheNextOne() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8)
        _ = try await read(source, offset: 0, length: 8)
        machine.version = "2-2"
        await #expect(throws: MachineClientError.invalid("The file changed while it played.")) {
            _ = try await read(source, offset: 8, length: 8)
        }
    }

    @Test func aCancelledReadStopsAsking() async throws {
        let machine = MediaMachine(size: 1_000)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 10, ahead: 2)
        let task = Task { @MainActor in
            try await source.read(offset: 0, length: 500, info: { _ in }) { _ in withUnsafeCurrentTask { $0?.cancel() } }
        }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(machine.asked.count == 3)
    }

    /// AVFoundation calls an optional delegate method only when its name matches the SDK's exactly.
    @Test func avFoundationReadsAVideoThroughTheLoader() async throws {
        let url = try #require(Bundle.module.url(forResource: "clip", withExtension: "mp4", subdirectory: "Fixtures"))
        let machine = MediaMachine(bytes: try Data(contentsOf: url))
        let loader = MachineMediaLoader(client: machine, path: "/videos/clip.mp4")
        let (duration, playable) = try await loader.asset().load(.duration, .isPlayable)
        #expect(playable)
        #expect(abs(duration.seconds - 1) < 0.2)
        #expect(!machine.asked.isEmpty)
        withExtendedLifetime(loader) {}
    }

    @Test func aRangePastTheEndFails() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4")
        await #expect(throws: MachineClientError.invalid("The player asked past the end of the file.")) {
            _ = try await read(source, offset: 200, length: 8)
        }
    }
}
