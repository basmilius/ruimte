import ComputerUseCore
import CoreGraphics
import Testing

struct TreeQueryTests {
    /// A window with a toolbar and a list, as the walker indents them.
    private let tree = [
        ElementText(index: 0, depth: 0, texts: ["Inbox"]),
        ElementText(index: 1, depth: 1, texts: ["toolbar"]),
        ElementText(index: 2, depth: 2, texts: ["Archive", "archive-button"]),
        ElementText(index: 3, depth: 1, texts: []),
        ElementText(index: 4, depth: 2, texts: ["Invoice from Tiël"]),
        ElementText(index: 5, depth: 3, texts: ["Paid"]),
        ElementText(index: 6, depth: 2, texts: ["Receipt"]),
    ]

    @Test func findsMatchesWithWhatTheySitIn() {
        #expect(TreeQuery.find("paid", in: tree) == [0, 3, 4, 5])
        #expect(TreeQuery.find("ARCHIVE-BUTTON", in: tree) == [0, 1, 2])
    }

    @Test func findsWithoutCaseOrAccents() {
        #expect(TreeQuery.find("tiel", in: tree) == [0, 3, 4])
    }

    @Test func keepsASharedAncestorOnce() {
        #expect(TreeQuery.find("re", in: tree) == [0, 3, 6])
        #expect(TreeQuery.find("i", in: tree) == [0, 1, 2, 3, 4, 5, 6])
    }

    @Test func findsNothingForTextNoElementHolds() {
        #expect(TreeQuery.find("draft", in: tree).isEmpty)
    }
}

struct WaitConditionTests {
    private let tree = [
        ElementText(index: 0, depth: 0, texts: ["Export"]),
        ElementText(index: 1, depth: 1, texts: ["Exporting 3 of 10"]),
    ]

    private func request(text: String? = nil, gone: String? = nil, element: Int? = nil, value: String? = nil) -> Request {
        var request = Request(command: "wait")
        request.text = text
        request.gone = gone
        request.element = element
        request.value = value
        return request
    }

    @Test func takesExactlyOneCondition() throws {
        #expect(try WaitCondition(request(text: "Done")) == .text("Done"))
        #expect(try WaitCondition(request(gone: "Exporting")) == .gone("Exporting"))
        #expect(try WaitCondition(request(element: 4, value: "100")) == .value(element: 4, "100"))
        #expect(throws: AgentError.self) { try WaitCondition(request()) }
        #expect(throws: AgentError.self) { try WaitCondition(request(text: "Done", gone: "Exporting")) }
        #expect(throws: AgentError.self) { try WaitCondition(request(element: 4)) }
        #expect(throws: AgentError.self) { try WaitCondition(request(value: "100")) }
    }

    @Test func holdsOnTheTreeOrTheValue() {
        #expect(WaitCondition.text("exporting").holds(tree, value: nil))
        #expect(!WaitCondition.text("Done").holds(tree, value: nil))
        #expect(!WaitCondition.gone("Exporting").holds(tree, value: nil))
        #expect(WaitCondition.gone("Exporting").holds([tree[0]], value: nil))
        #expect(WaitCondition.gone("Exporting").holds([], value: nil))
        #expect(WaitCondition.value(element: 1, "100").holds([], value: "100"))
        #expect(!WaitCondition.value(element: 1, "100").holds([], value: "10"))
        #expect(!WaitCondition.value(element: 1, "100").holds([], value: nil))
    }
}

struct DragPathTests {
    @Test func movesInEvenStepsAndEndsOnTheTarget() {
        let points = DragPath.points(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 100, y: 40), steps: 4)
        #expect(points == [CGPoint(x: 25, y: 10), CGPoint(x: 50, y: 20), CGPoint(x: 75, y: 30), CGPoint(x: 100, y: 40)])
        #expect(DragPath.points(from: .zero, to: CGPoint(x: 5, y: 5), steps: 0) == [CGPoint(x: 5, y: 5)])
    }
}
