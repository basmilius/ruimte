import ComputerUseCore
import Darwin
import Foundation

/// Accepts one request per connection: the client writes JSON and half-closes, the server answers and closes.
final class SocketServer: @unchecked Sendable {
    private let path: String
    private let handler: @Sendable (Data) async -> Data
    private var listener: Int32 = -1

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
            throw UnixSocket.Failure("socket() failed: \(String(cString: strerror(errno)))")
        }
        let bound = try UnixSocket.withAddress(path) { bind(descriptor, $0, $1) }
        guard bound == 0 else {
            close(descriptor)
            throw UnixSocket.Failure("bind(\(path)) failed: \(String(cString: strerror(errno)))")
        }
        chmod(path, 0o600)
        guard listen(descriptor, 16) == 0 else {
            close(descriptor)
            throw UnixSocket.Failure("listen() failed: \(String(cString: strerror(errno)))")
        }
        listener = descriptor

        let thread = Thread { [self] in
            acceptLoop()
        }
        thread.name = "agent-socket"
        thread.start()
    }

    private func acceptLoop() {
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
            UnixSocket.setReadTimeout(client, seconds: 10)
            let handler = self.handler
            Thread.detachNewThread {
                let request = UnixSocket.readAll(client)
                Task {
                    let response = await handler(request)
                    UnixSocket.writeAll(client, response)
                    close(client)
                }
            }
        }
    }
}
