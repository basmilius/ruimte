import Foundation
import WebKit

/// A loopback address in a browser node means the machine of its project, and the web view runs on this phone.
/// Until a port that machine shares opens through the connection, such an address is refused instead of
/// reaching whatever listens on the phone's own loopback.
enum BrowserLoopback {
    /// Whether the host is a spelling of this computer's own loopback that needs no name lookup, the shorthand
    /// and hexadecimal forms of IPv4 that the system accepts included.
    static func isLoopback(host rawHost: String) -> Bool {
        var host = rawHost.lowercased()
        while host.hasSuffix(".") { host.removeLast() }
        if host.hasPrefix("[") && host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        if host == "localhost" || host.hasSuffix(".localhost") { return true }

        var v4 = in_addr()
        if inet_aton(host, &v4) != 0 {
            let first = UInt32(bigEndian: v4.s_addr) >> 24
            return first == 127 || first == 0
        }

        var v6 = in6_addr()
        if inet_pton(AF_INET6, host, &v6) == 1 {
            let bytes = withUnsafeBytes(of: v6) { Array($0) }
            let zeros = bytes.dropLast().allSatisfy { $0 == 0 }
            if zeros { return bytes[15] <= 1 }
            // ::ffff:a.b.c.d, an IPv4 address in IPv6 clothes.
            let mapped = bytes[0..<10].allSatisfy { $0 == 0 } && bytes[10] == 0xff && bytes[11] == 0xff
            return mapped && (bytes[12] == 127 || bytes[12] == 0)
        }
        return false
    }

    static func isLoopback(_ url: URL) -> Bool {
        guard let host = url.host(percentEncoded: false) else { return false }
        return isLoopback(host: host)
    }

    static func refusal(for url: URL) -> String? {
        guard isLoopback(url) else { return nil }
        return String(localized: "This address is on the project's machine, which this browser cannot open yet.")
    }

    /// Content rules that keep a page from another site from asking this phone's loopback for anything: images,
    /// scripts, fetches and frames alike. Documents are judged by the navigation policy instead.
    static let contentRules: String = {
        // WebKit hands the rules the parsed URL, so an IPv4 shorthand is already dotted decimal and an IPv6 address
        // is compressed, with a mapped IPv4 address in hexadecimal. A trailing dot on a name stays. The syntax has
        // no disjunction and no counted repeat, so every spelling is a rule of its own.
        let hosts = [
            "localhost\\\\.?",
            "[^/:]*\\\\.localhost\\\\.?",
            "127\\\\.[0-9.]*",
            "0\\\\.[0-9.]*",
            "\\\\[::1\\\\]",
            "\\\\[::\\\\]",
            "\\\\[::ffff:7f[0-9a-f]*:[0-9a-f]*\\\\]",
            "\\\\[::ffff:[0-9a-f]?[0-9a-f]:[0-9a-f]*\\\\]",
        ]
        let types = ["image", "style-sheet", "script", "font", "raw", "svg-document", "media", "popup", "ping", "fetch", "websocket", "other"]
        let rules = hosts.map { host in
            """
            {"trigger":{"url-filter":"^[a-z]+://\(host)[:/]","url-filter-is-case-sensitive":false,"resource-type":\(json(types))},"action":{"type":"block"}}
            """
        }
        return "[" + rules.joined(separator: ",") + "]"
    }()

    private static func json(_ values: [String]) -> String {
        "[" + values.map { "\"\($0)\"" }.joined(separator: ",") + "]"
    }

    /// The rules compiled once, or nil when WebKit refuses them, which leaves the page without the extra layer.
    @MainActor static func compiledRules() async -> WKContentRuleList? {
        try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "ruimte-loopback", encodedContentRuleList: contentRules)
    }
}
