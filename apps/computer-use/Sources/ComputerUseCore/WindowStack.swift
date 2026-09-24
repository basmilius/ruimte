import CoreGraphics
import Foundation

/// One window as the window server lists it: frames in global points, top-left origin.
public struct StackedWindow: Equatable, Sendable {
    public let id: UInt32
    public let pid: Int32
    public let layer: Int
    public let frame: CGRect
    public let alpha: Double

    public init(id: UInt32, pid: Int32, layer: Int, frame: CGRect, alpha: Double = 1) {
        self.id = id
        self.pid = pid
        self.layer = layer
        self.frame = frame
        self.alpha = alpha
    }
}

/// Questions about the on-screen windows, listed front to back the way `CGWindowListCopyWindowInfo` does.
public enum WindowStack {
    /// The app whose window a click at the point lands on; `ignoring` is the helper itself, whose overlay lets clicks through.
    public static func owner(at point: CGPoint, in windows: [StackedWindow], ignoring: Int32) -> Int32? {
        windows.first { $0.pid != ignoring && $0.alpha > 0 && $0.frame.contains(point) }?.pid
    }

    /// Whether other apps' normal windows in front of the window hide all of it. Only the normal layer counts:
    /// panels and overlays above it are often transparent where they seem to cover.
    public static func isCovered(_ id: UInt32, in windows: [StackedWindow]) -> Bool {
        guard let position = windows.firstIndex(where: { $0.id == id }) else {
            return false
        }
        let target = windows[position]
        let above = windows[..<position].filter { $0.pid != target.pid && $0.layer == 0 && $0.alpha > 0 }.map(\.frame)
        return isCovered(target.frame, by: above)
    }

    /// Whether the rectangles together hide every point of the frame, to within a point.
    public static func isCovered(_ frame: CGRect, by covers: [CGRect]) -> Bool {
        var left = [frame.standardized]
        for cover in covers {
            left = left.flatMap { subtract(cover, from: $0) }
            if left.isEmpty {
                return true
            }
        }
        return left.allSatisfy { $0.width < 1 || $0.height < 1 }
    }

    /// What is left of a rectangle once another is cut out of it: at most four pieces.
    static func subtract(_ cover: CGRect, from rect: CGRect) -> [CGRect] {
        let overlap = rect.intersection(cover)
        guard !overlap.isNull, overlap.width > 0, overlap.height > 0 else {
            return [rect]
        }
        let pieces = [
            CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: overlap.minY - rect.minY),
            CGRect(x: rect.minX, y: overlap.maxY, width: rect.width, height: rect.maxY - overlap.maxY),
            CGRect(x: rect.minX, y: overlap.minY, width: overlap.minX - rect.minX, height: overlap.height),
            CGRect(x: overlap.maxX, y: overlap.minY, width: rect.maxX - overlap.maxX, height: overlap.height),
        ]
        return pieces.filter { $0.width > 0 && $0.height > 0 }
    }
}
