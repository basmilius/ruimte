import Foundation

/// What a crash report may carry of a string, the Swift twin of `createScrubber` in `packages/telemetry`: paths,
/// secrets, addresses, people and SQL are taken out. `CrashReportsTests` repeats the shared cases.
struct CrashScrubber: Sendable {
    static let maxMessage = 300
    static let maxTag = 200
    static let hosts = ["ruimte.app", "github.com", "githubusercontent.com", "sentry.io", "npmjs.org"]
    // Shorter values are too common as words to replace wherever they appear.
    private static let minRedaction = 4

    /// The app's home directory, whose folder name is the installation's own.
    private let home: NSRegularExpression?
    /// Values that never leave as they are, such as a project's name and folder, the longest first, so a folder
    /// goes whole before the name of the project inside it.
    private let literals: [String]

    init(home: String? = NSHomeDirectory(), redactions: [String] = []) {
        self.home = home.flatMap { home in
            home.isEmpty
                ? nil
                : try? NSRegularExpression(pattern: NSRegularExpression.escapedPattern(for: home) + #"(?![\w.-])"#)
        }
        literals = redactions.filter { $0.count >= Self.minRedaction }.sorted { $0.count > $1.count }
    }

    func scrubTag(_ text: String) -> String {
        Self.truncate(scrubText(text), Self.maxTag)
    }

    func scrubText(_ text: String) -> String {
        var result = Pattern.url.replace(in: text) { scrubURL(scheme: $0[1] ?? "", rest: $0[2] ?? "") }
        result = Pattern.email.replace(in: result) { _ in "<email>" }
        result = removePerson(result)
        result = Pattern.authScheme.replace(in: result) { "\($0[1] ?? "") <redacted>" }
        result = Pattern.jwt.replace(in: result) { _ in "<redacted>" }
        result = Pattern.secretPair.replace(in: result) { "\($0[1] ?? "")\($0[2] ?? "")<redacted>" }
        result = Pattern.environmentAssignment.replace(in: result) { "\($0[1] ?? "")=<redacted>" }
        result = Pattern.longToken.replace(in: result) { _ in "<redacted>" }
        result = Pattern.ipv4.replace(in: result) { groups in
            let address = groups[0] ?? ""
            return Self.isLoopback(address) || address == "0.0.0.0" ? address : "<ip>"
        }
        result = Pattern.ipv6.replace(in: result) { groups in
            let address = groups[0] ?? ""
            return Self.looksLikeIPv6(address) ? "<ip>" : address
        }
        result = Pattern.sql.replace(in: result) { _ in "<sql>" }
        result = Pattern.path.replace(in: result) { groups in
            Self.isPath(groups[2] ?? "") ? "\(groups[1] ?? "")<path>" : groups[0] ?? ""
        }
        result = Pattern.quoted.replace(in: result) { groups in
            let content = groups[2] ?? ""
            let quote = groups[1] ?? ""
            return content.contains(where: \.isWhitespace) || content.utf16.count >= 24
                ? "\(quote)<text>\(quote)" : groups[0] ?? ""
        }
        return result
    }

    /// Only the first line: what follows is often the output of a process or the text that failed to parse.
    func scrubMessage(_ text: String) -> String {
        let firstLine =
            text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).first.map(String.init) ?? ""
        return Self.truncate(scrubText(firstLine), Self.maxMessage)
    }

    /// A file of a stack frame or a loaded image: only the person is taken out, so the frame still resolves.
    func scrubPath(_ path: String) -> String {
        removePerson(path.replacingOccurrences(of: #"[?#].*$"#, with: "", options: .regularExpression))
    }

    static func truncate(_ text: String, _ limit: Int) -> String {
        text.count > limit ? "\(text.prefix(limit))..." : text
    }

    private func removePerson(_ text: String) -> String {
        var result = text
        for literal in literals {
            result = result.replacingOccurrences(of: literal, with: "<redacted>")
        }
        if let home {
            result = home.replace(in: result) { _ in "~" }
        }
        return Pattern.genericHome.replace(in: result) { _ in "~" }
    }

    private func scrubURL(scheme: String, rest: String) -> String {
        let end = rest.firstIndex { "/?#".contains($0) } ?? rest.endIndex
        let authority = rest[..<end]
        let remainder = rest[end...]
        let hostPort = authority.split(separator: "@", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        var host = hostPort
        var port = ""
        if let match = hostPort.range(of: #":\d+$"#, options: .regularExpression) {
            host = String(hostPort[..<match.lowerBound])
            port = String(hostPort[match])
        }
        let shownHost: String
        if host.isEmpty {
            shownHost = ""
        } else if Self.isLoopback(host) || Self.hosts.contains(where: { host == $0 || host.hasSuffix(".\($0)") }) {
            shownHost = host
        } else {
            shownHost = "<host>"
        }
        let path = remainder.isEmpty || remainder == "/" ? String(remainder) : "/<path>"
        return "\(scheme.lowercased())://\(shownHost)\(port)\(path)"
    }

    private static func isLoopback(_ host: String) -> Bool {
        host == "localhost" || host == "[::1]" || host == "::1" || host.hasPrefix("127.")
    }

    // A clock reads `08:35:12` and is no address; an address has a hex letter, `::` or more groups than a clock.
    private static func looksLikeIPv6(_ candidate: String) -> Bool {
        if candidate == "::1" || candidate == "::" {
            return false
        }
        return candidate.contains("::") || candidate.contains(where: { "abcdefABCDEF".contains($0) })
            || candidate.split(separator: ":", omittingEmptySubsequences: false).count > 4
    }

    // One segment from the root is a route such as `/health`; a path under the home or a drive always counts.
    private static func isPath(_ path: String) -> Bool {
        if path.hasPrefix("~") || path.range(of: "^[A-Za-z]:", options: .regularExpression) != nil {
            return true
        }
        return path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).count >= 2
    }
}

/// The patterns of `scrub.ts`, in ICU syntax.
private enum Pattern {
    static let url = regex(#"\b([a-z][a-z0-9+.-]*)://([^\s'"`<>()\[\]{}]*)"#, caseInsensitive: true)
    // The shared homes, and the containers iOS gives an installation, whose folder names are its own.
    static let genericHome = regex(
        #"(?:/Users|/home|[A-Za-z]:[\\/]Users)[\\/][^\\/\s'"`:]+|(?:/private)?/var/mobile/Containers/(?:Data|Shared)/(?:Application|AppGroup)/[0-9A-Fa-f-]+"#
    )
    static let authScheme = regex(#"\b(Bearer|Basic|Token)\s+[\w.~+/=-]+"#, caseInsensitive: true)
    static let jwt = regex(#"\beyJ[\w-]+\.[\w-]+\.[\w-]*"#)
    static let secretPair = regex(
        #"\b([\w.-]*?(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|private[_-]?key|access[_-]?key|auth(?:orization)?|credentials?|cookie|session[_-]?id|signature)[\w.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;&}]+)"#,
        caseInsensitive: true)
    static let environmentAssignment = regex(#"\b([A-Z][A-Z0-9_]*[A-Z0-9])=("[^"]*"|'[^']*'|\S+)"#)
    static let email = regex(#"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"#)
    static let longToken = regex(#"(?<![\w+=-])(?=[\w+=-]*\d)(?=[\w+=-]*[A-Za-z])[\w+=-]{32,}(?![\w+=-])"#)
    static let ipv4 = regex(#"\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b"#)
    static let ipv6 = regex(#"(?<![\w:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])"#)
    static let sql = regex(
        #"\b(?:SELECT\b[\s\S]*?\bFROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW|DATABASE|SCHEMA)|ALTER\s+TABLE|DROP\s+(?:TABLE|DATABASE|INDEX|VIEW|SCHEMA))\b[\s\S]*"#,
        caseInsensitive: true)
    static let path = regex(#"(^|[\s'"`(=\[,])((?:~|[A-Za-z]:)?(?:[\\/][^\s'"`()\[\]{},;:\\/]+)+[\\/]?)"#)
    static let quoted = regex(#"(['"`])([^'"`\n]{3,})\1"#)

    private static func regex(_ pattern: String, caseInsensitive: Bool = false) -> NSRegularExpression {
        // A pattern here is a literal, so a failure is a mistake in this file and every test would show it.
        try! NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }
}

extension NSRegularExpression {
    /// Every match replaced by what `transform` makes of its groups; group 0 is the whole match, nil one that did not take part.
    fileprivate func replace(in text: String, _ transform: ([String?]) -> String) -> String {
        let source = text as NSString
        var result = ""
        var last = 0
        for match in matches(in: text, range: NSRange(location: 0, length: source.length)) {
            result += source.substring(with: NSRange(location: last, length: match.range.location - last))
            let groups = (0..<match.numberOfRanges).map { index -> String? in
                let range = match.range(at: index)
                return range.location == NSNotFound ? nil : source.substring(with: range)
            }
            result += transform(groups)
            last = match.range.location + match.range.length
        }
        return result + source.substring(from: last)
    }
}
