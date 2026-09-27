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
    init(size: Int) { bytes = Data((0..<size).map { UInt8($0 % 251) }) }
    init(bytes: Data) { self.bytes = bytes }
    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        let offset = Int(payload["offset"]!.numberValue!)
        let length = Int(payload["length"]!.numberValue!)
        asked.append((offset, length))
        guard offset <= bytes.count else { throw MachineClientError.server(code: "bad-offset", message: "Past the end") }
        let slice = bytes.subdata(in: offset..<min(offset + length, bytes.count))
        return .object([
            "mime": .string("video/mp4"), "size": .number(Double(bytes.count)), "version": .string(version),
            "offset": .number(Double(offset)), "data": .string(slice.base64EncodedString()),
        ])
    }
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
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
        #expect(machine.asked.map(\.offset) == [10, 18, 26])
        #expect(machine.asked.map(\.length) == [8, 8, 4])
    }

    @Test func aReadToTheEndStopsAtTheWindow() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4", chunkBytes: 8, windowBytes: 24)
        let result = try await read(source, offset: 50, length: nil)
        #expect(result.data == machine.bytes.subdata(in: 50..<74))
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

    @Test func aRefusalFromTheMachineIsTheError() async throws {
        let machine = MediaMachine(size: 100)
        let source = MachineMediaSource(client: machine, path: "/v.mp4")
        await #expect(throws: MachineClientError.server(code: "bad-offset", message: "Past the end")) {
            _ = try await read(source, offset: 200, length: 8)
        }
    }
}
