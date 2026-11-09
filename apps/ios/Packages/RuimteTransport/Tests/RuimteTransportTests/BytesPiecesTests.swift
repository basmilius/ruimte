import Foundation
import RuimtePulsar
import Testing

@testable import RuimteTransport

@MainActor struct BytesPiecesTests {
    // `encodeBytesReply('7', { mime: 'video/mp4', size: 10, version: '1-10', offset: 4 }, [4, 5, 6])` from the contracts.
    private static let contractReply = Data(
        base64Encoded:
            "AQAAAE57ImlkIjoiNyIsInJlc3VsdCI6eyJtaW1lIjoidmlkZW8vbXA0Iiwic2l6ZSI6MTAsInZlcnNpb24iOiIxLTEwIiwib2Zmc2V0Ijo0fX0EBQY="
    )!

    private func reply(id: String, offset: Int, data: Data) throws -> Data {
        let head = try JSONValue.object([
            "id": .string(id),
            "result": .object([
                "mime": .string("video/mp4"), "size": .number(10), "version": .string("1-10"),
                "offset": .number(Double(offset)),
            ]),
        ]).encoded()
        var frame = Data([UInt8(WireConstants.bytesReplyKind)])
        withUnsafeBytes(of: UInt32(head.count).bigEndian) { frame.append(contentsOf: $0) }
        frame.append(head)
        frame.append(data)
        return frame
    }

    private func started<Value: Sendable>(_ read: @escaping @MainActor (MachineClient) async throws -> Value)
        async throws -> (client: MachineClient, task: Task<Value, any Error>, id: String, binary: Bool?)
    {
        var sent: [String] = []
        let client = MachineClient(send: { sent.append($0) }, connected: true)
        let task = Task { try await read(client) }
        while sent.isEmpty { await Task.yield() }
        let frame = try JSONValue.decode(Data(sent[0].utf8))
        return (client, task, frame["id"]!.stringValue!, frame["payload"]?["binary"]?.boolValue)
    }

    private let payload: JSONValue = .object([
        "resource": .object(["kind": .string("file"), "path": .string("/v.mp4")]), "offset": .number(4),
        "length": .number(3),
    ])

    @Test func aReplyTheContractsWriteReadsBack() throws {
        let reply = try #require(BytesReply(Self.contractReply))
        #expect(reply.id == "7")
        #expect(
            try BytesPiece(header: reply.header, data: reply.data)
                == BytesPiece(mime: "video/mp4", size: 10, version: "1-10", offset: 4, data: Data([4, 5, 6])))
        #expect(BytesReply(Data([2]) + Self.contractReply.dropFirst()) == nil)
        #expect(BytesReply(Self.contractReply.prefix(20)) == nil)
    }

    @Test func aHeaderWhoseNumbersAreNoCountOrPastTheResourceIsRefused() throws {
        func header(size: Double, offset: Double) -> JSONValue {
            .object([
                "mime": .string("video/mp4"), "size": .number(size), "version": .string("1-10"),
                "offset": .number(offset),
            ])
        }
        let refused: [(size: Double, offset: Double, count: Int)] = [
            (1e30, 0, 1), (10, 1e30, 1), (.infinity, 0, 1), (10, .nan, 1), (-1, 0, 0), (10, -1, 1), (10.5, 0, 1),
            (10, 0.5, 1), (10, 11, 0), (10, 8, 3), (Double(Int.max), Double(Int.max), 1),
        ]
        for value in refused {
            #expect(throws: MachineClientError.self) {
                try BytesPiece(header: header(size: value.size, offset: value.offset), data: Data(count: value.count))
            }
        }
        #expect(try BytesPiece(header: header(size: 10, offset: 7), data: Data(count: 3)).offset == 7)
        #expect(try BytesPiece(header: header(size: 10, offset: 10), data: Data()).size == 10)
        #expect(try BytesPiece(header: header(size: 0, offset: 0), data: Data()).size == 0)
    }

    @Test func aHeaderLengthPastTheFrameIsRefused() {
        var frame = Data([UInt8(WireConstants.bytesReplyKind)])
        withUnsafeBytes(of: UInt32.max.bigEndian) { frame.append(contentsOf: $0) }
        frame.append(Data("{}".utf8))
        #expect(BytesReply(frame) == nil)
    }

    @Test func binaryPiecesJoinAndTextPiecesAreNotBinary() {
        var assembler = MarkedFrameAssembler.binary
        #expect(assembler.push(Data([0x01, 1, 2]), maxBytes: 10) == .partial)
        #expect(assembler.push(Data([0x02, 3]), maxBytes: 10) == .frame(Data([1, 2, 3])))
        #expect(assembler.push(Data([0x02, 1, 2, 3]), maxBytes: 2) == .invalid)
        #expect(assembler.push(Data([0x02]), maxBytes: 2) == .frame(Data()))
        #expect(!assembler.accepts(Data("={}".utf8)))
        #expect(!assembler.accepts(Data("+{".utf8)))
    }

    // `Bun.deflateSync(JSON.stringify({ type: 'event', event: 'chat.status', payload: { text: 'héllo '.repeat(20) } }))`.
    private static let contractDeflated = Data(
        base64Encoded: "q1YqqSxIVbJSSi1LzStR0oHSVkrJGYklesUliSWlxUo6SgWJlTn5iSlKVtVKJakVIPmMwytzcvIVBgWlVFsLAA=="
    )!

    @Test func deflatedPiecesJoinApartFromBinaryAndTextPieces() {
        var assembler = MarkedFrameAssembler.deflated
        #expect(assembler.push(Data([0x03, 1, 2]), maxBytes: 10) == .partial)
        #expect(assembler.push(Data([0x04, 3]), maxBytes: 10) == .frame(Data([1, 2, 3])))
        #expect(assembler.push(Data([0x04, 1, 2, 3]), maxBytes: 2) == .invalid)
        #expect(assembler.push(Data([0x02, 1]), maxBytes: 10) == .invalid)
        #expect(!assembler.accepts(Data([0x01, 1])))
        #expect(!assembler.accepts(Data("={}".utf8)))
        #expect(!MarkedFrameAssembler.binary.accepts(Data([0x03, 1])))
    }

    @Test func aFrameTheContractsDeflatedInflatesBack() throws {
        let text = String(repeating: "héllo ", count: 20)
        #expect(
            try DirectFraming.inflate(Self.contractDeflated, maxBytes: 1_024)
                == #"{"type":"event","event":"chat.status","payload":{"text":"\#(text)"}}"#)
    }

    @Test func inflatingPastTheLimitOrGarbageIsRefused() {
        #expect(throws: InflateFailure.tooLarge) { try DirectFraming.inflate(Self.contractDeflated, maxBytes: 40) }
        #expect(throws: InflateFailure.invalid) {
            try DirectFraming.inflate(Data([0xFF, 0xFF, 0xFF, 0xFF]), maxBytes: 1_024)
        }
    }

    @Test func readBytesAsksForABinaryReplyAndTakesItsBytes() async throws {
        let read = try await started { [payload] in try await $0.readBytes(payload) }
        #expect(read.binary == true)
        await read.client.receiveBinaryInOrder(try reply(id: read.id, offset: 4, data: Data([4, 5, 6]))).value
        #expect(
            try await read.task.value
                == BytesPiece(mime: "video/mp4", size: 10, version: "1-10", offset: 4, data: Data([4, 5, 6])))
    }

    @Test func aJSONAnswerToABinaryReadIsInvalid() async throws {
        let read = try await started { [payload] in try await $0.readBytes(payload) }
        let frame = try JSONValue.object([
            "id": .string(read.id), "ok": .bool(true),
            "result": .object([
                "mime": .string("video/mp4"), "size": .number(10), "version": .string("1-10"), "offset": .number(4),
                "data": .string(Data([4, 5, 6]).base64EncodedString()),
            ]),
        ]).encoded()
        await read.client.receiveInOrder(String(decoding: frame, as: UTF8.self)).value
        await #expect(throws: MachineClientError.self) { try await read.task.value }
    }

    @Test func aBinaryReplyToARequestThatDidNotAskIsDropped() async throws {
        let read = try await started { [payload] in try await $0.request(.bytesRead, payload: payload) }
        await read.client.receiveBinaryInOrder(try reply(id: read.id, offset: 4, data: Data([4, 5, 6]))).value
        #expect(read.client.pendingRequestCount == 1)
        read.task.cancel()
    }
}
