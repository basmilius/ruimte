import Darwin
import Foundation

public enum UnixSocket {
    public struct Failure: Error, CustomStringConvertible {
        public let description: String

        public init(_ description: String) {
            self.description = description
        }

        static func system(_ call: String) -> Failure {
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
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            for (i, byte) in bytes.enumerated() {
                buffer[i] = byte
            }
        }
        let length = socklen_t(MemoryLayout<sockaddr_un>.size)
        address.sun_len = UInt8(length)
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

    public static func readAll(_ descriptor: Int32) -> Data {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = read(descriptor, &buffer, buffer.count)
            if count > 0 {
                data.append(buffer, count: count)
                continue
            }
            if count < 0 && errno == EINTR {
                continue
            }
            break
        }
        return data
    }

    @discardableResult
    public static func writeAll(_ descriptor: Int32, _ data: Data) -> Bool {
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else {
                return true
            }
            var offset = 0
            while offset < raw.count {
                let written = write(descriptor, base + offset, raw.count - offset)
                if written < 0 {
                    if errno == EINTR {
                        continue
                    }
                    return false
                }
                offset += written
            }
            return true
        }
    }

    public static func setReadTimeout(_ descriptor: Int32, seconds: Int) {
        var timeout = timeval(tv_sec: seconds, tv_usec: 0)
        setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    }

    public static func disableSigpipe(_ descriptor: Int32) {
        var on: Int32 = 1
        setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
    }
}
