import Foundation
import RuimtePulsar
import RuimteTransport

/// How a machine writes an absolute path. A Windows machine writes a drive and backslashes (`C:\Users\bas`), any other
/// machine starts at `/`. The style follows the machine and never the phone, which is why `URL(fileURLWithPath:)` and a
/// check on `/` cannot read a path from a Windows machine.
struct MachinePath: Equatable, Sendable {
    enum Style: Equatable, Sendable { case posix, windows }

    let style: Style

    /// `platform` is what `server.hello` and `endpoint.info` call it; only `win32` has drives.
    init(platform: String?) {
        style = platform == "win32" ? .windows : .posix
    }

    /// For a page that has only a path: a drive letter or a share names a Windows machine. A path the machine gave is
    /// absolute, so the guess cannot take a folder of that name on another machine for a drive.
    init(inferring path: String) {
        let drive = path.count >= 2 && path.first?.isASCII == true && path.first?.isLetter == true
            && path[path.index(after: path.startIndex)] == ":"
            && (path.count == 2 || "\\/".contains(path[path.index(path.startIndex, offsetBy: 2)]))
        style = drive || path.hasPrefix("\\\\") ? .windows : .posix
    }

    var separator: String { style == .windows ? "\\" : "/" }

    var example: String { style == .windows ? "C:\\Projects" : "~/projects" }

    /// The last segment, or the root itself for a root.
    func name(_ path: String) -> String {
        let parts = parts(path)
        return parts.names.last ?? parts.root
    }

    /// The folder above, ready to list; a root stays itself.
    func parent(_ path: String) -> String {
        let parts = parts(path)
        return parts.root + parts.names.dropLast().joined(separator: separator)
    }

    /// Whether `path` is `root` or inside it. A Windows machine does not tell `C:\Work` from `c:\work`.
    func isBelow(_ path: String, root: String) -> Bool {
        let inner = parts(path)
        let outer = parts(root)
        guard fold(inner.root) == fold(outer.root), inner.names.count >= outer.names.count else { return false }
        return zip(inner.names, outer.names).allSatisfy { fold($0) == fold($1) }
    }

    /// The lowercased extension of the last segment; none for a dotfile.
    func fileExtension(_ path: String) -> String {
        let name = name(path)
        guard let dot = name.lastIndex(of: "."), dot != name.startIndex else { return "" }
        return String(name[name.index(after: dot)...]).lowercased()
    }

    private func fold(_ text: String) -> String { style == .windows ? text.lowercased() : text }

    /// The root (`/`, `C:\`, `\\server\share\`, or none for a relative path) and the segments after it.
    private func parts(_ path: String) -> (root: String, names: [String]) {
        guard style == .windows else {
            let rooted = path.hasPrefix("/")
            return (rooted ? "/" : "", path.split(separator: "/").map(String.init))
        }
        let normalized = path.replacingOccurrences(of: "/", with: "\\")
        let share = normalized.hasPrefix("\\\\")
        var segments = normalized.split(separator: "\\").map(String.init)
        if share, segments.count >= 2 {
            let root = "\\\\\(segments[0])\\\(segments[1])\\"
            return (root, Array(segments.dropFirst(2)))
        }
        if let first = segments.first, first.count == 2, first.last == ":" {
            segments.removeFirst()
            return (first + "\\", segments)
        }
        return (normalized.hasPrefix("\\") ? "\\" : "", segments)
    }
}

extension MachinePath {
    /// Where a machine's files, and any other browsing, start: its start folder while that is still there, else its
    /// home. The machine names its own home: `fs.browse` answers `~/` as an absolute folder, where `server.hello` calls
    /// Ruimte's data folder home, which a client may not read.
    @MainActor static func startFolder(client: any MachineRequesting) async throws -> String {
        let info = try? await client.request(.endpointInfo).decoded(as: EndpointInfo.self)
        let kept = info?.startFolder?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !kept.isEmpty {
            let separator = MachinePath(platform: info?.platform).separator
            let listing = try? await client.request(
                .fsBrowse, payload: .object(["partialPath": .string(kept.hasSuffix(separator) ? kept : kept + separator)])
            ).decoded(as: FsBrowseResult.self)
            if let listing, listing.exists != false, !listing.parentPath.isEmpty {
                return listing.parentPath
            }
        }
        return try await client.request(.fsBrowse, payload: .object(["partialPath": .string("~/")]))
            .decoded(as: FsBrowseResult.self).parentPath
    }
}
