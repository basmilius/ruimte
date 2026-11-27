import Foundation

public let sampleRate = 16_000

/// Ten minutes of audio, the longest a dictation may last.
public let maxSamples = sampleRate * 600

public enum SamplesError: Error, Equatable, CustomStringConvertible {
    case notBase64
    case partialSample
    case notFinite

    public var description: String {
        switch self {
        case .notBase64:
            return "Audio is not base64"
        case .partialSample:
            return "Audio ends inside a sample"
        case .notFinite:
            return "Audio contains a non-finite sample"
        }
    }
}

/// Mono 32-bit float samples, little-endian, as the shell sends them.
public func samples(fromBase64 text: String) throws -> [Float] {
    guard let bytes = Data(base64Encoded: text) else {
        throw SamplesError.notBase64
    }

    return try samples(from: bytes)
}

public func samples(from bytes: Data) throws -> [Float] {
    guard bytes.count % 4 == 0 else {
        throw SamplesError.partialSample
    }

    let decoded = stride(from: 0, to: bytes.count, by: 4).map { offset in
        let start = bytes.startIndex + offset
        let bits = UInt32(bytes[start]) | UInt32(bytes[start + 1]) << 8 | UInt32(bytes[start + 2]) << 16 | UInt32(bytes[start + 3]) << 24

        return Float(bitPattern: bits)
    }

    guard decoded.allSatisfy(\.isFinite) else {
        throw SamplesError.notFinite
    }

    return decoded
}
