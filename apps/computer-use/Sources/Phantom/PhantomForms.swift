import CoreGraphics
import Foundation

public struct CubicSegment: Equatable, Sendable {
    public var control1: CGPoint
    public var control2: CGPoint
    public var end: CGPoint
}

/// A closed outline of exactly four cubic segments. Every form has the same shape of path, so any two
/// interpolate point by point and the first point of each travels to the first point of the other.
public struct PhantomPath: Equatable, Sendable {
    public var start: CGPoint
    public var segments: [CubicSegment]

    public var cgPath: CGPath {
        let path = CGMutablePath()
        path.move(to: start)
        for segment in segments {
            path.addCurve(to: segment.end, control1: segment.control1, control2: segment.control2)
        }
        path.closeSubpath()
        return path
    }

    /// Reads a path this type drew back into its points; nil for any other path.
    public init?(cgPath: CGPath) {
        var start: CGPoint?
        var segments: [CubicSegment] = []
        var valid = true
        cgPath.applyWithBlock { element in
            let points = element.pointee.points
            switch element.pointee.type {
            case .moveToPoint:
                start = points[0]
            case .addCurveToPoint:
                segments.append(CubicSegment(control1: points[0], control2: points[1], end: points[2]))
            case .closeSubpath:
                break
            default:
                valid = false
            }
        }
        guard valid, let start, segments.count == 4 else {
            return nil
        }
        self.init(start: start, segments: segments)
    }

    public init(start: CGPoint, segments: [CubicSegment]) {
        self.start = start
        self.segments = segments
    }

    /// `t` may leave 0...1, which is how a spring easing overshoots the target form.
    public static func interpolate(_ from: PhantomPath, _ to: PhantomPath, _ t: CGFloat) -> PhantomPath {
        let mix = { (a: CGPoint, b: CGPoint) in CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t) }
        return PhantomPath(
            start: mix(from.start, to.start),
            segments: zip(from.segments, to.segments).map { pair in
                CubicSegment(control1: mix(pair.0.control1, pair.1.control1), control2: mix(pair.0.control2, pair.1.control2), end: mix(pair.0.end, pair.1.end))
            }
        )
    }
}

public enum PhantomForm: String, CaseIterable, Sendable {
    case arrow
    case dot
    case small
    case finger

    public var path: PhantomPath {
        switch self {
        case .arrow:
            return PhantomGeometry.poly([CGPoint(x: 4, y: 3.5), CGPoint(x: 20.5, y: 10.5), CGPoint(x: 13.5, y: 13.5), CGPoint(x: 10.5, y: 20.5)])
        case .dot:
            return PhantomGeometry.tear(tip: CGPoint(x: 4, y: 3.5), center: CGPoint(x: 12.5, y: 12.5), radius: 7)
        case .small:
            return PhantomGeometry.tear(tip: CGPoint(x: 4, y: 3.5), center: CGPoint(x: 10.5, y: 10.5), radius: 4.5)
        case .finger:
            return PhantomGeometry.oval(center: CGPoint(x: 4, y: 3.5), radiusX: 10, radiusY: 10)
        }
    }
}

/// The path math of the design, in its 24 × 24 box with y down. Every coordinate is rounded to hundredths as the
/// design's path strings are, so a form here is the very outline the design draws.
public enum PhantomGeometry {
    /// Half up, as the design's rounding does, also for negative values.
    static func round(_ value: CGFloat) -> CGFloat {
        (value * 100 + 0.5).rounded(.down) / 100
    }

    static func round(_ point: CGPoint) -> CGPoint {
        CGPoint(x: round(point.x), y: round(point.y))
    }

    /// A straight side as a cubic, with its handles on the thirds.
    static func line(_ from: CGPoint, _ to: CGPoint) -> CubicSegment {
        CubicSegment(
            control1: round(CGPoint(x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3)),
            control2: round(CGPoint(x: from.x + 2 * (to.x - from.x) / 3, y: from.y + 2 * (to.y - from.y) / 3)),
            end: round(to)
        )
    }

    public static func poly(_ corners: [CGPoint]) -> PhantomPath {
        PhantomPath(start: round(corners[0]), segments: corners.indices.map { line(corners[$0], corners[($0 + 1) % corners.count]) })
    }

    /// A drop: the tip, the two tangent points on the circle and the far side of it.
    public static func tear(tip: CGPoint, center: CGPoint, radius: CGFloat) -> PhantomPath {
        let phi = atan2(tip.y - center.y, tip.x - center.x)
        let opening = acos(radius / hypot(tip.x - center.x, tip.y - center.y))
        let onCircle = { (angle: CGFloat) in CGPoint(x: center.x + radius * cos(angle), y: center.y + radius * sin(angle)) }
        let arc = { (from: CGFloat, to: CGFloat) -> CubicSegment in
            let handle = 4 / 3 * tan((to - from) / 4) * radius
            let start = onCircle(from)
            let end = onCircle(to)
            return CubicSegment(
                control1: round(CGPoint(x: start.x - handle * sin(from), y: start.y + handle * cos(from))),
                control2: round(CGPoint(x: end.x + handle * sin(to), y: end.y - handle * cos(to))),
                end: round(end)
            )
        }
        let first = phi + opening
        let middle = phi + .pi
        let last = phi + 2 * .pi - opening
        return PhantomPath(start: round(tip), segments: [
            line(tip, onCircle(first)),
            arc(first, middle),
            arc(middle, last),
            line(onCircle(last), tip),
        ])
    }

    /// An ellipse from four quarter arcs, starting at the upper left, the quarter that faces the hotspot corner of the other forms.
    public static func oval(center: CGPoint, radiusX: CGFloat, radiusY: CGFloat) -> PhantomPath {
        let angles: [CGFloat] = [225, 315, 45, 135].map { $0 * .pi / 180 }
        let points = angles.map { CGPoint(x: center.x + radiusX * cos($0), y: center.y + radiusY * sin($0)) }
        let tangents = angles.map { CGPoint(x: -radiusX * sin($0), y: radiusY * cos($0)) }
        let handle: CGFloat = 0.5523
        let segments = (0..<4).map { i -> CubicSegment in
            let next = (i + 1) % 4
            return CubicSegment(
                control1: round(CGPoint(x: points[i].x + handle * tangents[i].x, y: points[i].y + handle * tangents[i].y)),
                control2: round(CGPoint(x: points[next].x - handle * tangents[next].x, y: points[next].y - handle * tangents[next].y)),
                end: round(points[next])
            )
        }
        return PhantomPath(start: round(points[0]), segments: segments)
    }
}
