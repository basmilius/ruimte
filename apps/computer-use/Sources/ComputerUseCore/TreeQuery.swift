import CoreGraphics
import Foundation

/// The text of one line of a tree, whole where the line cuts it: what `--find` and `wait` read.
public struct ElementText: Equatable, Sendable {
    public let index: Int
    /// The indent of its line, which is how the tree says what sits inside what.
    public let depth: Int
    /// Title, value, description and identifier, whichever it has.
    public let texts: [String]

    public init(index: Int, depth: Int, texts: [String]) {
        self.index = index
        self.depth = depth
        self.texts = texts
    }

    public func contains(_ query: String) -> Bool {
        texts.contains { $0.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
    }
}

public enum TreeQuery {
    /// The positions of the elements that match and of every element above one, in tree order.
    public static func find(_ query: String, in elements: [ElementText]) -> [Int] {
        var kept = Set<Int>()
        for (position, element) in elements.enumerated() where element.contains(query) {
            kept.insert(position)
            var depth = element.depth
            var above = position - 1
            while above >= 0 && depth > 0 {
                if elements[above].depth < depth {
                    // One kept already has everything above it kept too.
                    guard kept.insert(above).inserted else {
                        break
                    }
                    depth = elements[above].depth
                }
                above -= 1
            }
        }
        return kept.sorted()
    }
}

/// What `wait` holds out for.
public enum WaitCondition: Equatable, Sendable {
    /// Some element carries the text.
    case text(String)
    /// No element carries the text any more.
    case gone(String)
    /// The element from the last state has exactly this value.
    case value(element: Int, String)

    public static let defaultTimeout: Double = 10
    public static let maxTimeout: Double = 110

    /// Exactly one of `text`, `gone`, or `element` with `value`.
    public init(_ request: Request) throws {
        var conditions: [WaitCondition] = []
        if let text = request.text, !text.isEmpty {
            conditions.append(.text(text))
        }
        if let gone = request.gone, !gone.isEmpty {
            conditions.append(.gone(gone))
        }
        if let element = request.element {
            guard let value = request.value else {
                throw AgentError("wait --element N needs --value V")
            }
            conditions.append(.value(element: element, value))
        } else if request.value != nil {
            throw AgentError("wait --value V needs --element N")
        }
        guard conditions.count == 1, let condition = conditions.first else {
            throw AgentError("wait takes one of --text T, --gone T, or --element N with --value V")
        }
        self = condition
    }

    /// `value` is the live value of the element a `.value` condition names, nil when it has none.
    public func holds(_ elements: [ElementText], value: String?) -> Bool {
        switch self {
        case let .text(text):
            return elements.contains { $0.contains(text) }
        case let .gone(text):
            return !elements.contains { $0.contains(text) }
        case let .value(_, wanted):
            return value == wanted
        }
    }

    public var summary: String {
        switch self {
        case let .text(text):
            return "text \"\(text)\" appears"
        case let .gone(text):
            return "text \"\(text)\" is gone"
        case let .value(element, value):
            return "element \(element) has value \"\(value)\""
        }
    }
}

public enum DragPath {
    /// The points a drag moves through after the press, evenly spaced, ending on `end`.
    public static func points(from start: CGPoint, to end: CGPoint, steps: Int) -> [CGPoint] {
        let count = max(1, steps)
        return (1...count).map { step in
            let progress = CGFloat(step) / CGFloat(count)
            return CGPoint(x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress)
        }
    }
}
