import AVFoundation
import Foundation
import RuimtePulsar
import UniformTypeIdentifiers

public struct MachineMediaInfo: Sendable, Equatable {
    public let mime: String
    public let size: Int
    public let version: String
}

/// A file on a machine read in ranges, the way a player asks for it: over `bytes.read`, a few pieces on their way
/// at once. The first piece pins the version, and a piece of another version fails the read, since a player that
/// mixes two files shows neither.
@MainActor public final class MachineMediaSource {
    private let client: any MachineRequesting
    private let path: String
    private let chunkBytes: Int
    private let ahead: Int
    private let windowBytes: Int
    public private(set) var info: MachineMediaInfo?

    /// `windowBytes` bounds a read to the end of the file; the player asks for what follows itself.
    public init(
        client: any MachineRequesting, path: String, chunkBytes: Int = Int(WireConstants.bytesChunkMax), ahead: Int = 2,
        windowBytes: Int = 8 * 1_024 * 1_024
    ) {
        self.client = client
        self.path = path
        self.chunkBytes = min(max(chunkBytes, 1), Int(WireConstants.bytesChunkMax))
        self.ahead = max(ahead, 1)
        self.windowBytes = max(windowBytes, 1)
    }

    /// Hands over at most `length` bytes from `offset`, or the window when `length` is nil, piece by piece as they
    /// arrive. What the machine said about the file comes first, with the first piece.
    public func read(offset: Int, length: Int?, info onInfo: (MachineMediaInfo) -> Void, deliver: (Data) -> Void)
        async throws
    {
        let wanted = min(length.map { max($0, 1) } ?? windowBytes, windowBytes)
        let first = try await piece(at: offset, length: min(chunkBytes, wanted))
        let info = try pin(first)
        onInfo(info)
        let last = min(info.size, offset + wanted) - 1
        guard offset <= last else { return }

        var pending: [Task<JSONValue, any Error>] = []
        defer { pending.forEach { $0.cancel() } }
        var next = offset + first.bytes.count
        var position = offset
        var current = first
        while true {
            let bytes = current.bytes.prefix(last + 1 - position)
            guard !bytes.isEmpty else { throw MachineClientError.invalid("The machine sent an empty piece.") }
            deliver(Data(bytes))
            position += bytes.count
            if position > last { return }
            while pending.count < ahead, next <= last {
                let at = next
                let size = min(chunkBytes, last + 1 - at)
                pending.append(Task { try await self.request(at: at, length: size) })
                next += size
            }
            try Task.checkCancellation()
            let reply = try await pending.removeFirst().value
            current = try parse(reply, at: position)
            guard current.version == info.version, current.size == info.size else {
                throw MachineClientError.invalid("The file changed while it played.")
            }
        }
    }

    private struct Piece {
        let mime: String
        let size: Int
        let version: String
        let bytes: Data
    }

    private func request(at offset: Int, length: Int) async throws -> JSONValue {
        let reply = try await client.request(
            .bytesRead,
            payload: .object([
                "resource": .object(["kind": .string("file"), "path": .string(path)]),
                "offset": .number(Double(offset)), "length": .number(Double(length)),
            ]))
        return try WireRequest.bytesRead.validateResult(reply)
    }

    private func piece(at offset: Int, length: Int) async throws -> Piece {
        try parse(try await request(at: offset, length: length), at: offset)
    }

    private func parse(_ reply: JSONValue, at offset: Int) throws -> Piece {
        guard let size = reply["size"]?.numberValue, let version = reply["version"]?.stringValue,
            reply["offset"]?.numberValue == Double(offset), let encoded = reply["data"]?.stringValue,
            let bytes = Data(base64Encoded: encoded), bytes.count <= chunkBytes
        else {
            throw MachineClientError.invalid("The machine sent an invalid piece of the file.")
        }
        return Piece(mime: reply["mime"]?.stringValue ?? "application/octet-stream", size: Int(size), version: version, bytes: bytes)
    }

    private func pin(_ first: Piece) throws -> MachineMediaInfo {
        let info = MachineMediaInfo(mime: first.mime, size: first.size, version: first.version)
        if let pinned = self.info, pinned.version != info.version || pinned.size != info.size {
            throw MachineClientError.invalid("The file changed while it played.")
        }
        self.info = info
        return info
    }
}

/// Lets `AVPlayer` read a file on a machine in the ranges it asks for, so a video starts after its first piece,
/// seeks without the rest, and has no size limit. The asset holds its loader weakly: keep the loader as long as
/// the player.
@MainActor public final class MachineMediaLoader: NSObject, AVAssetResourceLoaderDelegate {
    // A scheme AVFoundation cannot load itself, which is what hands every request to the delegate.
    public static let scheme = "ruimte-media"
    private let source: MachineMediaSource
    private let name: String
    private var loads: [ObjectIdentifier: Task<Void, Never>] = [:]

    public init(client: any MachineRequesting, path: String) {
        source = MachineMediaSource(client: client, path: path)
        name = URL(fileURLWithPath: path).lastPathComponent
    }

    public func asset() -> AVURLAsset {
        let url = URL(string: "\(Self.scheme)://file/")!.appending(path: name.isEmpty ? "media" : name)
        let asset = AVURLAsset(url: url)
        asset.resourceLoader.setDelegate(self, queue: .main)
        return asset
    }

    public func cancel() {
        loads.values.forEach { $0.cancel() }
        loads.removeAll()
    }

    nonisolated public func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader, shouldWaitForLoadingOf loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        let request = LoadingRequest(value: loadingRequest)
        MainActor.assumeIsolated { start(request) }
        return true
    }

    nonisolated public func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest
    ) {
        let key = ObjectIdentifier(loadingRequest)
        MainActor.assumeIsolated { loads.removeValue(forKey: key)?.cancel() }
    }

    private func start(_ request: LoadingRequest) {
        let key = ObjectIdentifier(request.value)
        loads[key] = Task { [source] in
            let loading = request.value
            let describe = { (info: MachineMediaInfo) in
                guard let content = loading.contentInformationRequest else { return }
                content.contentType = UTType(mimeType: info.mime)?.identifier
                content.contentLength = Int64(info.size)
                content.isByteRangeAccessSupported = true
            }
            do {
                if let data = loading.dataRequest {
                    let length = data.requestsAllDataToEndOfResource ? nil : data.requestedLength
                    try await source.read(offset: Int(data.requestedOffset), length: length, info: describe) {
                        data.respond(with: $0)
                    }
                } else {
                    try await source.read(offset: 0, length: 1, info: describe) { _ in }
                }
                if !Task.isCancelled { loading.finishLoading() }
            } catch {
                if !Task.isCancelled { loading.finishLoading(with: error) }
            }
            loads.removeValue(forKey: key)
        }
    }
}

/// A loading request only ever touched on the main queue, which is where the loader asks AVFoundation to call it.
private struct LoadingRequest: @unchecked Sendable {
    let value: AVAssetResourceLoadingRequest
}
