import ComputerUseCore
import Darwin
import Foundation
import Synchronization

/// Accepts one request per connection: the client writes JSON and half-closes, the server answers and closes.
final class SocketServer: Sendable {
    // Far above any request the daemon sends; the text of a `type` is the largest.
    static let maxRequestBytes = 4 * 1024 * 1024
    // Connections served at once, each on a thread of its own; the next waits in the listen backlog.
    static let maxConnections = 16
    static let requestDeadline: Duration = .seconds(10)
    static let answerDeadline: Duration = .seconds(10)

    private let path: String
    private let handler: @Sendable (Data) async -> Data
    private let slots = DispatchSemaphore(value: SocketServer.maxConnections)

    init(path: String, handler: @escaping @Sendable (Data) async -> Data) {
        self.path = path
        self.handler = handler
    }

    func start() throws {
        let directory = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        chmod(directory, 0o700)

        if let existing = UnixSocket.connect(to: path) {
            close(existing)
            throw UnixSocket.Failure("another agent already listens on \(path)")
        }
        unlink(path)

        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            throw UnixSocket.Failure.system("socket()")
        }
        let bound = try UnixSocket.withAddress(path) { bind(descriptor, $0, $1) }
        guard bound == 0 else {
            let failure = UnixSocket.Failure.system("bind(\(path))")
            close(descriptor)
            throw failure
        }
        chmod(path, 0o600)
        guard listen(descriptor, 16) == 0 else {
            let failure = UnixSocket.Failure.system("listen()")
            close(descriptor)
            throw failure
        }
        let thread = Thread { [self] in
            acceptLoop(descriptor)
        }
        thread.name = "agent-socket"
        thread.start()
    }

    private func acceptLoop(_ listener: Int32) {
        while true {
            let client = accept(listener, nil, nil)
            if client < 0 {
                if errno == EINTR {
                    continue
                }
                return
            }
            // Security boundary: the socket drives input on this Mac, so only this user's processes may use it.
            var uid: uid_t = 0
            var gid: gid_t = 0
            guard getpeereid(client, &uid, &gid) == 0, uid == getuid() else {
                close(client)
                continue
            }
            UnixSocket.disableSigpipe(client)
            slots.wait()
            Thread.detachNewThread { [self] in
                serve(client)
                close(client)
                slots.signal()
            }
        }
    }

    /// Runs on the connection's own thread, so a slow peer blocks that thread and never one of the cooperative pool.
    private func serve(_ client: Int32) {
        let request: Data
        switch UnixSocket.readAll(client, maxBytes: Self.maxRequestBytes, until: .now + Self.requestDeadline) {
        case .complete(let data):
            request = data
        case .tooLarge:
            UnixSocket.writeAll(client, Data(#"{"ok":false,"error":"the request is larger than 4 MiB"}"#.utf8), until: .now + Self.answerDeadline)
            return
        case .timedOut, .failed:
            return
        }
        let answer = Answer()
        let handler = self.handler
        Task {
            let data = await handler(request)
            answer.data.withLock { $0 = data }
            answer.ready.signal()
        }
        answer.ready.wait()
        UnixSocket.writeAll(client, answer.data.withLock { $0 }, until: .now + Self.answerDeadline)
    }
}

/// The handler's answer, handed from its task to the connection's thread once `ready` signals.
private final class Answer: Sendable {
    let ready = DispatchSemaphore(value: 0)
    let data = Mutex(Data())
}
