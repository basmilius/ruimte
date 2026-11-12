import XCTest

@testable import Ruimte

final class BrowserLoopbackTests: XCTestCase {
    func testEverySpellingOfThisComputersLoopbackIsRefused() {
        for address in [
            "http://localhost:3000/", "http://LOCALHOST./", "http://app.localhost:5173/", "http://127.0.0.1:3000/",
            "http://127.1:3000/", "http://0x7f.1/", "http://2130706433/", "http://127.255.255.254/", "http://[::1]:8080/",
            "http://0.0.0.0:3000/", "http://[::]/", "http://[::ffff:127.0.0.1]:3000/", "https://localhost/", "ws://localhost:3000/",
        ] {
            XCTAssertNotNil(BrowserLoopback.refusal(for: URL(string: address)!), address)
        }
    }

    func testOtherAddressesLoad() {
        for address in [
            "https://example.com/", "http://192.168.1.20:3000/", "http://10.0.0.5/", "http://localhost.example.com/",
            "http://notlocalhost/", "http://128.0.0.1/", "http://[2001:db8::1]/", "http://[::ffff:8.8.8.8]/", "about:blank",
        ] {
            XCTAssertNil(BrowserLoopback.refusal(for: URL(string: address)!), address)
        }
    }

    func testTheRefusalIsAnEnglishSentenceInTheTests() {
        XCTAssertEqual(
            BrowserLoopback.refusal(for: URL(string: "http://localhost:3000/")!),
            "This address is on the project's machine, which this browser cannot open.")
    }

    /// What the rules match, read as the regular expressions they are, on the URL WebKit parsed.
    private func rulesBlock(_ address: String) throws -> Bool {
        let data = try XCTUnwrap(BrowserLoopback.contentRules.data(using: .utf8))
        let rules = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        return try rules.contains { rule in
            let trigger = try XCTUnwrap(rule["trigger"] as? [String: Any])
            let pattern = try XCTUnwrap(trigger["url-filter"] as? String)
            let regex = try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
            return regex.firstMatch(in: address, range: NSRange(address.startIndex..., in: address)) != nil
        }
    }

    func testTheContentRulesBlockEverySpellingIsLoopbackCatches() throws {
        for address in [
            "http://localhost/x.png", "http://localhost:3000/", "http://localhost./x.png", "http://foo.localhost/", "http://foo.localhost./",
            "http://127.0.0.1:3000/", "http://127.0.0.1./", "http://[::1]:3000/", "http://[::]:3000/", "http://[::]/",
            "http://[::ffff:7f00:1]:3000/", "http://[::ffff:7f00:1]/", "http://[::ffff:0:1]/", "http://[::ffff:a:b]/", "http://0.0.0.0:3000/",
            "http://0.1.2.3/", "ws://localhost.:3000/",
        ] {
            XCTAssertTrue(try rulesBlock(address), address)
        }
    }

    func testTheContentRulesLeaveOtherHostsAlone() throws {
        for address in [
            "https://example.com/", "http://localhost.example.com/", "http://notlocalhost/", "http://128.0.0.1/", "http://10.0.0.5/",
            "http://[2001:db8::1]/", "http://[::ffff:808:808]/", "http://[::ffff:c0a8:1]/", "http://[::2]/", "http://0.example.com/",
        ] {
            XCTAssertFalse(try rulesBlock(address), address)
        }
    }

    func testTheContentRulesAreRulesWebKitTakes() async throws {
        let data = try XCTUnwrap(BrowserLoopback.contentRules.data(using: .utf8))
        let rules = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        XCTAssertFalse(rules.isEmpty)
        for rule in rules {
            XCTAssertEqual((rule["action"] as? [String: String])?["type"], "block")
            let trigger = try XCTUnwrap(rule["trigger"] as? [String: Any])
            XCTAssertFalse((trigger["resource-type"] as? [String] ?? []).contains("document"))
        }
        let compiled = await BrowserLoopback.compiledRules()
        XCTAssertNotNil(compiled)
    }
}
