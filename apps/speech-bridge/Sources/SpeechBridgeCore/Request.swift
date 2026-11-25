import Foundation

/// One line the shell writes to the helper's stdin.
public enum Request: Equatable, Sendable {
    case start(sessionId: String, language: String)
    case samples(sessionId: String, audio: String)
    case stop(sessionId: String)
    case cancel(sessionId: String)

    public var sessionId: String {
        switch self {
        case .start(let sessionId, _), .samples(let sessionId, _), .stop(let sessionId), .cancel(let sessionId):
            return sessionId
        }
    }
}

public enum RequestError: Error, Equatable, CustomStringConvertible {
    case tooLarge
    case invalid

    public var description: String {
        switch self {
        case .tooLarge:
            return "Speech message too large"
        case .invalid:
            return "Invalid speech message"
        }
    }
}

private struct Line: Decodable {
    let type: String
    let sessionId: String
    let language: String?
    let audio: String?
}

/// A second of 16 kHz samples is about 85 KB in base64, the longest line the shell sends, so this leaves room to spare.
public let maxLineBytes = 128 * 1024

public func parseRequest(_ line: String) throws -> Request {
    guard line.utf8.count <= maxLineBytes else {
        throw RequestError.tooLarge
    }

    guard let decoded = try? JSONDecoder().decode(Line.self, from: Data(line.utf8)) else {
        throw RequestError.invalid
    }

    switch (decoded.type, decoded.language, decoded.audio) {
    case ("start", .some(let language), _):
        return .start(sessionId: decoded.sessionId, language: language)
    case ("samples", _, .some(let audio)):
        return .samples(sessionId: decoded.sessionId, audio: audio)
    case ("stop", _, _):
        return .stop(sessionId: decoded.sessionId)
    case ("cancel", _, _):
        return .cancel(sessionId: decoded.sessionId)
    default:
        throw RequestError.invalid
    }
}
