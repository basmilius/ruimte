import Darwin
import Foundation

public enum UnixSocket {
    public struct Failure: Error, CustomStringConvertible {
        public let description: String

        public init(_ description: String) {
            self.description = description
        }

        /// The failure of a call that set `errno`.
        public static func system(_ call: String) -> Failure {
            Failure("\(call) failed: \(String(cString: strerror(errno)))")
        }
    }

    public static func withAddress<T>(_ path: String, _ body: (UnsafePointer<sockaddr>, socklen_t) -> T) throws -> T {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else {
            throw Failure("socket path is too long: \(path)")
        }
        // In bounds by the guard above, which also leaves room for the NUL that `sockaddr_un()` zeroed.
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            for (i, byte) in bytes.enumerated() {
                buffer[i] = byte
            }
        }
        let length = socklen_t(MemoryLayout<sockaddr_un>.size)
        address.sun_len = UInt8(length)
        // The socket calls take every address as a `sockaddr` with its length, and the pointer lives only for `body`.
        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { body($0, length) }
        }
    }

    /// Returns nil when nobody listens; `errno` then says why.
    public static func connect(to path: String) -> Int32? {
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            return nil
        }
        let result = (try? withAddress(path) { Darwin.connect(descriptor, $0, $1) }) ?? -1
        guard result == 0 else {
            let saved = errno
            close(descriptor)
            errno = saved
            return nil
        }
        disableSigpipe(descriptor)
        return descriptor
    }

    public enum ReadOutcome: Equatable, Sendable {
        case complete(Data)
        case tooLarge
        case timedOut
        case failed
    }

    /// Reads until the peer half-closes, but never past `maxBytes` or `deadline`: a timeout on the socket counts per
    /// `read`, so a peer that sends a byte at a time would otherwise hold the connection open for good.
    public static func readAll(_ descriptor: Int32, maxBytes: Int, until deadline: ContinuousClock.Instant) -> ReadOutcome {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            guard setTimeout(descriptor, SO_RCVTIMEO, until: deadline) else {
                return .timedOut
            }
            let count = read(descriptor, &buffer, buffer.count)
            if count > 0 {
                data.append(buffer, count: count)
                if data.count > maxBytes {
                    return .tooLarge
                }
                continue
            }
            if count == 0 {
                return .complete(data)
            }
            if errno == EINTR {
                continue
            }
            return errno == EAGAIN || errno == EWOULDBLOCK ? .timedOut : .failed
        }
    }

    /// Writes everything, or gives up once `deadline` passes on a peer that stopped reading.
    @discardableResult
    public static func writeAll(_ descriptor: Int32, _ data: Data, until deadline: ContinuousClock.Instant? = nil) -> Bool {
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else {
                return true
            }
            var offset = 0
            while offset < raw.count {
                if let deadline, !setTimeout(descriptor, SO_SNDTIMEO, until: deadline) {
                    return false
                }
                // `offset` stays below `raw.count`, so the range written stays inside the buffer.
                let written = write(descriptor, base + offset, raw.count - offset)
                if written < 0 {
                    if errno == EINTR || (deadline != nil && (errno == EAGAIN || errno == EWOULDBLOCK)) {
                        continue
                    }
                    return false
                }
                offset += written
            }
            return true
        }
    }

    /// Sets the socket's timeout to what is left until `deadline`; false once nothing is left.
    private static func setTimeout(_ descriptor: Int32, _ option: Int32, until deadline: ContinuousClock.Instant) -> Bool {
        let left = ContinuousClock.now.duration(to: deadline)
        guard left > .zero else {
            return false
        }
        // A zero timeval means no timeout at all, so the last moments round up to a millisecond.
        let microseconds = max(left.components.seconds * 1_000_000 + left.components.attoseconds / 1_000_000_000_000, 1_000)
        var timeout = timeval(tv_sec: Int(microseconds / 1_000_000), tv_usec: Int32(microseconds % 1_000_000))
        return setsockopt(descriptor, SOL_SOCKET, option, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0
    }

    public static func disableSigpipe(_ descriptor: Int32) {
        var on: Int32 = 1
        setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
    }
}
