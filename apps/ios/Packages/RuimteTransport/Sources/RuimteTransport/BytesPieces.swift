import Foundation
import RuimtePulsar

/// A piece of a resource on a machine with its bytes as they are, whether the machine sent a binary reply or, from
/// before those, base64 in JSON.
public struct BytesPiece: Sendable, Equatable {
    public let mime: String
    public let size: Int
    public let version: String
    public let offset: Int
    public let data: Data

    public init(mime: String, size: Int, version: String, offset: Int, data: Data) {
        self.mime = mime
        self.size = size
        self.version = version
        self.offset = offset
        self.data = data
    }

    /// The header of a binary reply with the bytes that followed it.
    public init(header: JSONValue, data: Data) throws {
        guard let mime = header["mime"]?.stringValue, let size = header["size"]?.numberValue,
            let version = header["version"]?.stringValue, let offset = header["offset"]?.numberValue,
            data.count <= Int(WireConstants.bytesChunkMax)
        else {
            throw MachineClientError.invalid("The machine sent an invalid resource piece.")
        }
        self.init(mime: mime, size: Int(size), version: version, offset: Int(offset), data: data)
    }

    /// A `bytes.read` result in JSON, its bytes in base64.
    public init(json result: JSONValue) throws {
        guard let encoded = result["data"]?.stringValue,
            encoded.utf8.count <= ((Int(WireConstants.bytesChunkMax) + 2) / 3) * 4,
            let data = Data(base64Encoded: encoded)
        else {
            throw MachineClientError.invalid("The machine sent an invalid resource piece.")
        }
        try self.init(header: result, data: data)
    }
}

/// A `bytes.read` reply as one binary frame, as `encodeBytesReply` in the contracts writes it: a kind byte, the length
/// of a JSON header as a big-endian uint32, the header (`{ id, result }`, the result without `data`), then the bytes.
public struct BytesReply: Sendable {
    public let id: String
    public let header: JSONValue
    public let data: Data

    public init?(_ frame: Data) {
        let start = frame.startIndex
        guard frame.count >= 5, frame[start] == UInt8(WireConstants.bytesReplyKind) else { return nil }
        let length = frame[(start + 1)..<(start + 5)].reduce(0) { $0 << 8 | Int($1) }
        let headEnd = start + 5 + length
        guard headEnd <= frame.endIndex, let head = try? JSONValue.decode(Data(frame[(start + 5)..<headEnd])),
            let id = head["id"]?.stringValue, let result = head["result"]
        else { return nil }
        self.id = id
        header = result
        data = Data(frame[headEnd...])
    }
}
