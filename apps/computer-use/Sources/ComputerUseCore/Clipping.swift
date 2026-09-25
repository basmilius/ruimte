import CoreGraphics

/// Chromium reports an element that its container clips away at that container's edge, often with no height or no
/// width, and still lists it and what it holds. Such a frame says where the element is hidden, not that it is gone.
public enum Clipping {
    /// One element of a subtree read in tree order; `depth` counts from the root of that read.
    public struct Laid: Equatable, Sendable {
        public let depth: Int
        /// `nil` when the element reports no frame.
        public let frame: CGRect?

        public init(depth: Int, frame: CGRect?) {
            self.depth = depth
            self.frame = frame
        }
    }

    /// Whether nothing of a frame shows: it lies outside `visible`, or it is the strip of a point or less that
    /// Chromium leaves of an element clipped away.
    public static func isOffscreen(_ frame: CGRect, within visible: CGRect) -> Bool {
        frame.width <= 1 || frame.height <= 1 || !frame.intersects(visible)
    }

    /// How many lines of a tree go to elements out of view, so a canvas or a long pane never pushes out what shows.
    public static func offscreenLines(of maxElements: Int) -> Int {
        max(1, maxElements / 5)
    }

    /// Of the frames of what sits in a container, in tree order, the one that lies wholly past the container's edge
    /// in `direction`: the first past the far edge, or the last before the near one, so bringing it into view scrolls
    /// the container one step that way.
    public static func revealTarget(_ frames: [CGRect?], in container: CGRect, direction: ScrollDirection) -> Int? {
        // Chromium puts a clipped element on the edge itself, a point either side of it after rounding.
        let tolerance: CGFloat = 1
        let past: (CGRect) -> Bool = switch direction {
        case .down: { $0.minY >= container.maxY - tolerance }
        case .right: { $0.minX >= container.maxX - tolerance }
        case .up: { $0.maxY <= container.minY + tolerance }
        case .left: { $0.maxX <= container.minX + tolerance }
        }
        let hidden: (CGRect?) -> Bool = { frame in frame.map(past) ?? false }
        return direction == .down || direction == .right ? frames.firstIndex(where: hidden) : frames.lastIndex(where: hidden)
    }

    /// The element to bring into view to scroll one step, looking inside each of `containers` in turn (positions in
    /// `elements`, nearest first) and skipping one without area, which clips nothing.
    public static func revealTarget(in elements: [Laid], containers: [Int], direction: ScrollDirection) -> Int? {
        for container in containers where elements.indices.contains(container) {
            guard let area = elements[container].frame, area.width >= 1, area.height >= 1 else {
                continue
            }
            let depth = elements[container].depth
            let start = container + 1
            let end = elements[start...].firstIndex { $0.depth <= depth } ?? elements.endIndex
            if let offset = revealTarget(elements[start..<end].map(\.frame), in: area, direction: direction) {
                return start + offset
            }
        }
        return nil
    }
}
