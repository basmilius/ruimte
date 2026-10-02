import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class TerminalCompatibilityTests: XCTestCase {
    /// SwiftTerm's own view resize soft-resets the terminal, which a program on the remote never asked for.
    @MainActor func testAContainerSizeChangeKeepsTheRemoteGridAndItsModes() {
        for fontSize in [10.0, 14, 17, 26] {
            let container = TerminalContainer(frame: CGRect(x: 0, y: 0, width: 402, height: 700))
            container.configure(fontSize: fontSize, theme: "dark")
            container.setDimensions(cols: 80, rows: 24)
            container.layoutIfNeeded()
            let terminal = container.terminal.getTerminal()
            container.terminal.feed(text: "\u{1b}[?1h\u{1b}[?25l\u{1b}[5;10r")
            for height in [700.0, 380, 874, 520] {
                container.frame.size.height = height
                container.layoutIfNeeded()
                container.terminal.layoutIfNeeded()
                XCTAssertEqual(terminal.cols, 80, "\(fontSize) pt at \(height)")
                XCTAssertEqual(terminal.rows, 24, "\(fontSize) pt at \(height)")
                XCTAssertTrue(terminal.applicationCursor, "\(fontSize) pt at \(height)")
                XCTAssertEqual(terminal.buffer.scrollTop, 4, "\(fontSize) pt at \(height)")
                XCTAssertEqual(terminal.buffer.scrollBottom, 9, "\(fontSize) pt at \(height)")
            }
            container.setDimensions(cols: 120, rows: 40)
            container.layoutIfNeeded()
            container.terminal.layoutIfNeeded()
            XCTAssertEqual(terminal.cols, 120, "\(fontSize) pt")
            XCTAssertEqual(terminal.rows, 40, "\(fontSize) pt")
            XCTAssertTrue(terminal.applicationCursor, "\(fontSize) pt")
        }
    }

    @MainActor func testModernAttachOnlyFollowsAndDeliversOneSnapshot() async throws {
        let client = TerminalCompatibilityClient()
        let attachment = client.acquireAttachment("session", id: "terminal")
        var snapshots: [JSONValue] = []
        let result = try await TerminalSnapshot.load(attachment: attachment, client: client, sessionID: "terminal") {
            snapshots.append($0)
        }
        XCTAssertEqual(client.requests.map(\.0), ["session.attach"])
        XCTAssertEqual(client.requests[0].1, .object(["sessionId": .string("terminal"), "follow": .bool(true)]))
        XCTAssertEqual(snapshots, [result])
    }

    @MainActor func testOlderDaemonRetriesWithItsCurrentDimensionsAndKeepsFollowing() async throws {
        let client = TerminalCompatibilityClient()
        client.rejection = .server(code: "bad-request", message: "Invalid payload for session.attach")
        let attachment = client.acquireAttachment("session", id: "terminal")
        var snapshots: [JSONValue] = []
        let result = try await TerminalSnapshot.load(attachment: attachment, client: client, sessionID: "terminal") {
            snapshots.append($0)
        }
        XCTAssertEqual(client.requests.map(\.0), ["session.attach", "session.list", "session.attach"])
        XCTAssertEqual(
            client.requests.last?.1,
            .object([
                "sessionId": .string("terminal"), "follow": .bool(true), "cols": .number(173), "rows": .number(51),
            ]))
        XCTAssertEqual(snapshots, [result])
    }

    @MainActor func testOtherServerErrorsDoNotRetryAttachment() async {
        let client = TerminalCompatibilityClient()
        client.rejection = .server(code: "forbidden", message: "Not authorized")
        let attachment = client.acquireAttachment("session", id: "terminal")
        do {
            _ = try await TerminalSnapshot.load(attachment: attachment, client: client, sessionID: "terminal") { _ in }
            XCTFail("The request should have failed")
        } catch {
            XCTAssertEqual(error as? MachineClientError, client.rejection)
        }
        XCTAssertEqual(client.requests.map(\.0), ["session.attach"])
    }

    @MainActor func testInvalidLegacyDimensionsNeverFallBackToPhoneDimensions() async {
        for dimensions: (JSONValue, JSONValue) in [
            (.number(0), .number(24)), (.number(80), .null), (.number(80.5), .number(24)),
        ] {
            let client = TerminalCompatibilityClient()
            client.rejection = .server(code: "bad-request", message: "Invalid payload for session.attach")
            client.cols = dimensions.0
            client.rows = dimensions.1
            let attachment = client.acquireAttachment("session", id: "terminal")
            do {
                _ = try await TerminalSnapshot.load(attachment: attachment, client: client, sessionID: "terminal") {
                    _ in
                }
                XCTFail("The invalid terminal size should have been refused")
            } catch {
                XCTAssertEqual(
                    error as? MachineClientError, .invalid("The machine did not report a valid terminal size."))
            }
            XCTAssertEqual(client.requests.map(\.0), ["session.attach", "session.list"])
        }
    }
}

@MainActor private final class TerminalCompatibilityClient: MachineRequesting {
    var requests: [(String, JSONValue)] = []
    var rejection: MachineClientError?
    var cols = JSONValue.number(173)
    var rows = JSONValue.number(51)

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if type == "session.attach", payload["cols"] == nil, let rejection { throw rejection }
        if type == "session.list" {
            return .object([
                "sessions": .array([
                    .object(["sessionId": .string("unrelated"), "cols": .number(80), "rows": .number(24)]),
                    .object(["sessionId": .string("terminal"), "cols": cols, "rows": rows]),
                ])
            ])
        }
        return .object(["screen": .string("screen"), "cols": cols, "rows": rows, "exited": .bool(false)])
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
