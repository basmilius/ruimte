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
        let attachment = client.acquireAttachment(.session, id: "terminal")
        var snapshots: [JSONValue] = []
        let result = try await TerminalSnapshot.load(attachment: attachment, sessionID: "terminal") {
            snapshots.append($0)
        }
        XCTAssertEqual(client.requests.map(\.0), [.sessionAttach])
        XCTAssertEqual(client.requests[0].1, .object(["sessionId": .string("terminal"), "follow": .bool(true)]))
        XCTAssertEqual(snapshots, [result])
    }

    @MainActor func testARefusedAttachmentIsNotRetried() async {
        let client = TerminalCompatibilityClient()
        client.rejection = .server(code: "bad-request", message: "Invalid payload for session.attach")
        let attachment = client.acquireAttachment(.session, id: "terminal")
        do {
            _ = try await TerminalSnapshot.load(attachment: attachment, sessionID: "terminal") { _ in }
            XCTFail("The request should have failed")
        } catch {
            XCTAssertEqual(error as? MachineClientError, client.rejection)
        }
        XCTAssertEqual(client.requests.map(\.0), [.sessionAttach])
    }
}

@MainActor private final class TerminalCompatibilityClient: MachineRequesting {
    var requests: [(WireRequest, JSONValue)] = []
    var rejection: MachineClientError?

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if let rejection { throw rejection }
        return .object(["screen": .string("screen"), "cols": .number(173), "rows": .number(51), "exited": .bool(false)])
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
