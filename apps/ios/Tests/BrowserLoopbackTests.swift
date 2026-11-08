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
            "This address is on the project's machine, which this browser cannot open yet.")
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
