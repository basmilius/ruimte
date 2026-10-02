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
///
/// Pieces sit on a grid of `chunkBytes` and each crosses the connection once: it goes to a spool file, which every
/// later read of it comes from. AVFoundation asks overlapping ranges at once, asks again after a stall and again on a
/// seek back, and without that a third of what crossed the connection was bytes it already had. The source also reads
/// ahead of the furthest piece asked for, since AVFoundation leaves the connection idle between its requests and a
/// video near the connection's throughput cannot spare that.
@MainActor public final class MachineMediaSource {
    private let client: any MachineRequesting
    private let path: String
    private let chunkBytes: Int
    private let ahead: Int
    private let readAheadPieces: Int
    private let reconnectWaitMs: Int
    private let spool: MediaSpool?
    private var stored = Set<Int>()
    private var inFlight: [Int: Task<BytesPiece, any Error>] = [:]
    // The furthest piece a read asked for, which reading ahead runs from.
    private var frontier = -1
    // Off after a piece that did not reach the spool, which reading ahead would otherwise ask again at once, without
    // end. A piece a read brings in turns it back on.
    private var readingAhead = true
    private var cancelled = false
    public private(set) var info: MachineMediaInfo?
    var spoolURL: URL? { spool?.url }

    /// `ahead` pieces on their way at once. Three binary replies stay under the daemon's output gate of 1 MB; above it,
    /// a terminal on the same connection loses output until it resyncs. `readAheadPieces` is how far past the furthest
    /// piece asked for the source reads on its own; 0 reads only on request. A piece that failed while the connection
    /// was down is asked again once it is back, for at most `reconnectWaitMs`.
    public init(
        client: any MachineRequesting, path: String, chunkBytes: Int = Int(WireConstants.bytesChunkMax), ahead: Int = 2,
        readAheadPieces: Int = 0, reconnectWaitMs: Int = 30_000
    ) {
        self.client = client
        self.path = path
        self.chunkBytes = min(max(chunkBytes, 1), Int(WireConstants.bytesChunkMax))
        self.ahead = max(ahead, 1)
        self.readAheadPieces = max(readAheadPieces, 0)
        self.reconnectWaitMs = max(reconnectWaitMs, 0)
        spool = try? MediaSpool()
    }

    /// Hands over at most `length` bytes from `offset`, or the rest of the file when `length` is nil, piece by piece as
    /// they arrive, until the file ends or the task is cancelled. What the machine said about the file comes first.
    public func read(offset: Int, length: Int?, info onInfo: (MachineMediaInfo) -> Void, deliver: (Data) -> Void)
        async throws
    {
        let wanted = length.map { max($0, 1) } ?? Int.max
        var index = offset / chunkBytes
        reach(index)
        var current = try await value(of: index)
        let info = try pin(current)
        onInfo(info)
        guard offset <= info.size else {
            throw MachineClientError.invalid("The player asked past the end of the file.")
        }
        let last = offset + min(info.size - offset, wanted) - 1
        guard offset <= last else { return }
        let lastIndex = last / chunkBytes

        var position = offset
        while true {
            let base = index * chunkBytes
            let end = min(current.data.count, last + 1 - base)
            guard position - base < end else { throw MachineClientError.invalid("The machine sent an empty piece.") }
            let start = current.data.startIndex
            deliver(Data(current.data[(start + position - base)..<(start + end)]))
            position = base + end
            if position > last { return }
            index += 1
            reach(index)
            for next in index..<min(index + ahead, lastIndex + 1) where inFlight.count < ahead {
                fetch(next)
            }
            try Task.checkCancellation()
            current = try await value(of: index)
            guard current.version == info.version, current.size == info.size else {
                throw MachineClientError.invalid("The file changed while it played.")
            }
        }
    }

    /// Stops every piece on its way and asks nothing more; a read after it fails.
    public func cancel() {
        cancelled = true
        for task in inFlight.values { task.cancel() }
        inFlight.removeAll()
    }

    /// Asks for the piece at `index` unless it is in the spool or on its way.
    @discardableResult private func fetch(_ index: Int) -> Task<BytesPiece, any Error>? {
        if let task = inFlight[index] { return task }
        guard !cancelled, !stored.contains(index) else { return nil }
        let offset = index * chunkBytes
        let length = info.map { max(min(chunkBytes, $0.size - offset), 1) } ?? chunkBytes
        // Weak, so reading ahead ends with the last player that holds the source.
        let task = Task { [weak self] () async throws -> BytesPiece in
            do {
                guard let piece = try await self?.request(at: offset, length: length) else { throw CancellationError() }
                self?.settle(index, piece: piece)
                return piece
            } catch {
                self?.settle(index, piece: nil)
                throw error
            }
        }
        inFlight[index] = task
        return task
    }

    private func settle(_ index: Int, piece: BytesPiece?) {
        inFlight.removeValue(forKey: index)
        // The first piece arrives before it pins the file, and reading ahead waits for that.
        guard let info else { return }
        if let piece, let spool, info.version == piece.version, info.size == piece.size,
            (try? spool.write(piece.data, at: index * chunkBytes)) != nil
        {
            stored.insert(index)
            readingAhead = true
            readAhead()
        } else {
            readingAhead = false
        }
    }

    private func reach(_ index: Int) {
        guard index > frontier else { return }
        frontier = index
        readAhead()
    }

    /// Keeps up to `ahead` pieces on their way until the window past the frontier is in the spool.
    private func readAhead() {
        guard readingAhead, !cancelled, readAheadPieces > 0, spool != nil, let info, info.size > 0 else { return }
        let lastPiece = (info.size - 1) / chunkBytes
        let end = lastPiece - frontier <= readAheadPieces ? lastPiece : frontier + readAheadPieces
        var next = max(frontier, 0)
        while inFlight.count < ahead, next <= end {
            fetch(next)
            next += 1
        }
    }

    private func value(of index: Int) async throws -> BytesPiece {
        if stored.contains(index), let info, let spool {
            let offset = index * chunkBytes
            let data = try spool.read(at: offset, count: min(chunkBytes, info.size - offset))
            return BytesPiece(mime: info.mime, size: info.size, version: info.version, offset: offset, data: data)
        }
        guard !cancelled else { throw CancellationError() }
        guard let task = fetch(index) else { throw MachineClientError.invalid("The spool lost a piece of the file.") }
        return try await task.value
    }

    private func request(at offset: Int, length: Int) async throws -> BytesPiece {
        var waited = 0
        while true {
            try Task.checkCancellation()
            do {
                let piece = try await client.readBytes(
                    .object([
                        "resource": .object(["kind": .string("file"), "path": .string(path)]),
                        "offset": .number(Double(offset)), "length": .number(Double(length)),
                    ]))
                guard piece.offset == offset, piece.data.count <= chunkBytes else {
                    throw MachineClientError.invalid("The machine sent an invalid piece of the file.")
                }
                return piece
            } catch {
                // A dropped connection fails every piece on its way; the next connection answers them, so a player
                // waits out a reconnect instead of stalling on an error.
                guard !(error is CancellationError), !connected(), waited < reconnectWaitMs else { throw error }
                while !connected() {
                    guard waited < reconnectWaitMs else { throw error }
                    try await Task.sleep(for: .milliseconds(250))
                    waited += 250
                }
            }
        }
    }

    private func connected() -> Bool {
        let state = ConnectionFlag()
        client.observeConnection { state.value = $0 }()
        return state.value
    }

    private func pin(_ first: BytesPiece) throws -> MachineMediaInfo {
        let info = MachineMediaInfo(mime: first.mime, size: first.size, version: first.version)
        if let pinned = self.info, pinned.version != info.version || pinned.size != info.size {
            throw MachineClientError.invalid("The file changed while it played.")
        }
        self.info = info
        return info
    }
}

@MainActor private final class ConnectionFlag {
    var value = true
}

/// A temporary file the pieces of one file on a machine go to, at their own offsets. It goes with its source.
final class MediaSpool {
    let url: URL
    private let handle: FileHandle

    init() throws {
        url = FileManager.default.temporaryDirectory.appending(path: "ruimte-media-\(UUID().uuidString)")
        guard FileManager.default.createFile(atPath: url.path(), contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        handle = try FileHandle(forUpdating: url)
    }

    func write(_ data: Data, at offset: Int) throws {
        try handle.seek(toOffset: UInt64(offset))
        try handle.write(contentsOf: data)
    }

    func read(at offset: Int, count: Int) throws -> Data {
        try handle.seek(toOffset: UInt64(offset))
        return try handle.read(upToCount: count) ?? Data()
    }

    deinit {
        try? handle.close()
        try? FileManager.default.removeItem(at: url)
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
    // Off the main queue, which AVFoundation may itself be waiting on while an asset loads.
    private let queue = DispatchQueue(label: "app.ruimte.media-loader")
    private var loads: [ObjectIdentifier: Task<Void, Never>] = [:]
    /// What the machine last refused, which says more than the error AVFoundation wraps it in.
    public private(set) var failure: (any Error)?

    public init(client: any MachineRequesting, path: String) {
        // Measured on an iPhone: three pieces peaked at 12 to 13 MB/s, five at no more than 10.
        // Read ahead to the end of the file, since AVFoundation asks at about the pace it plays and a connection that
        // waits for it builds no lead.
        source = MachineMediaSource(client: client, path: path, ahead: 3, readAheadPieces: .max)
        name = URL(fileURLWithPath: path).lastPathComponent
    }

    public func asset() -> AVURLAsset {
        let url = URL(string: "\(Self.scheme)://file/")!.appending(path: name.isEmpty ? "media" : name)
        let asset = AVURLAsset(url: url)
        asset.resourceLoader.setDelegate(self, queue: queue)
        return asset
    }

    public func cancel() {
        loads.values.forEach { $0.cancel() }
        loads.removeAll()
        source.cancel()
    }

    nonisolated public func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        let request = LoadingRequest(value: loadingRequest)
        Task { @MainActor in self.start(request) }
        return true
    }

    nonisolated public func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest
    ) {
        let key = ObjectIdentifier(loadingRequest)
        Task { @MainActor in self.loads.removeValue(forKey: key)?.cancel() }
    }

    private func start(_ request: LoadingRequest) {
        // A cancel can overtake the hop to the main actor.
        guard !request.value.isCancelled else { return }
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
                if !Task.isCancelled {
                    failure = error
                    loading.finishLoading(with: error)
                }
            }
            loads.removeValue(forKey: key)
        }
    }
}

/// A loading request handed from the loader's queue to the main actor, which alone answers it from then on.
private struct LoadingRequest: @unchecked Sendable {
    let value: AVAssetResourceLoadingRequest
}
