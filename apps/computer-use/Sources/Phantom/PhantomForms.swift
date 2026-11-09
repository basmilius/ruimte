import CoreGraphics
import Foundation

/// A closed outline of `count` points spread evenly along its length, clockwise on the screen, starting at the
/// point with the smallest x + y. Every form is one, so any two morph point by point without turning inside out.
public struct PhantomOutline: Equatable, Sendable {
    public static let count = 160

    public var points: [CGPoint]

    public init(points: [CGPoint]) {
        self.points = points
    }

    /// Reads an outline this type drew back into its points; nil for any other path.
    public init?(cgPath: CGPath) {
        var points: [CGPoint] = []
        var valid = true
        cgPath.applyWithBlock { element in
            switch element.pointee.type {
            case .moveToPoint, .addLineToPoint:
                points.append(element.pointee.points[0])
            case .closeSubpath:
                break
            default:
                valid = false
            }
        }
        guard valid, points.count == Self.count else {
            return nil
        }
        self.points = points
    }

    public var cgPath: CGPath {
        let path = CGMutablePath()
        path.addLines(between: points)
        path.closeSubpath()
        return path
    }

    public static func interpolate(_ from: PhantomOutline, _ to: PhantomOutline, _ t: CGFloat) -> PhantomOutline {
        PhantomOutline(points: zip(from.points, to.points).map { pair in
            CGPoint(x: pair.0.x + (pair.1.x - pair.0.x) * t, y: pair.0.y + (pair.1.y - pair.0.y) * t)
        })
    }

    /// Samples the first closed subpath of `path` as the design's `sampleForm` does with `getPointAtLength`.
    public static func sample(_ path: CGPath) -> PhantomOutline {
        let polyline = flatten(path)
        var lengths: [CGFloat] = [0]
        for index in 1..<polyline.count {
            lengths.append(lengths[index - 1] + hypot(polyline[index].x - polyline[index - 1].x, polyline[index].y - polyline[index - 1].y))
        }
        let total = lengths[lengths.count - 1]
        var points: [CGPoint] = []
        var segment = 1
        for index in 0..<count {
            let along = total * CGFloat(index) / CGFloat(count)
            while segment < lengths.count - 1 && lengths[segment] < along {
                segment += 1
            }
            let span = lengths[segment] - lengths[segment - 1]
            let t = span > 0 ? (along - lengths[segment - 1]) / span : 0
            let from = polyline[segment - 1]
            let to = polyline[segment]
            points.append(CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
        }
        var area: CGFloat = 0
        for index in points.indices {
            let next = points[(index + 1) % points.count]
            area += points[index].x * next.y - next.x * points[index].y
        }
        // With y down, a positive area runs clockwise on the screen.
        if area < 0 {
            points.reverse()
        }
        var start = 0
        for index in points.indices where points[index].x + points[index].y < points[start].x + points[start].y {
            start = index
        }
        return PhantomOutline(points: Array(points[start...] + points[..<start]))
    }

    /// The path as a fine polyline that ends where it starts.
    private static func flatten(_ path: CGPath) -> [CGPoint] {
        let steps = 64
        var polyline: [CGPoint] = []
        var current = CGPoint.zero
        var start = CGPoint.zero
        var closed = false
        path.applyWithBlock { element in
            guard !closed else {
                return
            }
            let points = element.pointee.points
            switch element.pointee.type {
            case .moveToPoint:
                current = points[0]
                start = current
                polyline = [current]
            case .addLineToPoint:
                current = points[0]
                polyline.append(current)
            case .addQuadCurveToPoint:
                let from = current
                for step in 1...steps {
                    let t = CGFloat(step) / CGFloat(steps)
                    let inverse = 1 - t
                    polyline.append(CGPoint(
                        x: inverse * inverse * from.x + 2 * inverse * t * points[0].x + t * t * points[1].x,
                        y: inverse * inverse * from.y + 2 * inverse * t * points[0].y + t * t * points[1].y
                    ))
                }
                current = points[1]
            case .addCurveToPoint:
                let from = current
                for step in 1...steps {
                    let t = CGFloat(step) / CGFloat(steps)
                    let inverse = 1 - t
                    let a = inverse * inverse * inverse
                    let b = 3 * inverse * inverse * t
                    let c = 3 * inverse * t * t
                    let d = t * t * t
                    polyline.append(CGPoint(
                        x: a * from.x + b * points[0].x + c * points[1].x + d * points[2].x,
                        y: a * from.y + b * points[0].y + c * points[1].y + d * points[2].y
                    ))
                }
                current = points[2]
            case .closeSubpath:
                if current != start {
                    polyline.append(start)
                }
                closed = true
            @unknown default:
                break
            }
        }
        return polyline
    }
}

public struct CubicSegment: Equatable, Sendable {
    public var control1: CGPoint
    public var control2: CGPoint
    public var end: CGPoint
}

/// A closed outline of cubic segments, as the design writes the arrow and the finger.
public struct PhantomPath: Equatable, Sendable {
    public var start: CGPoint
    public var segments: [CubicSegment]

    public init(start: CGPoint, segments: [CubicSegment]) {
        self.start = start
        self.segments = segments
    }

    public var cgPath: CGPath {
        let path = CGMutablePath()
        path.move(to: start)
        for segment in segments {
            path.addCurve(to: segment.end, control1: segment.control1, control2: segment.control2)
        }
        path.closeSubpath()
        return path
    }
}

public enum PhantomForm: String, CaseIterable, Sendable {
    case arrow
    case finger
    /// The closed hand of dragging, with the middle of its palm on the hotspot as the system's grab cursor.
    case hand
    /// The text cursor of typing, 16 tall and centered on the hotspot.
    case beam

    public var outline: PhantomOutline {
        Self.outlines[self]!
    }

    /// Sampled once: every state change reads them.
    private static let outlines: [PhantomForm: PhantomOutline] = Dictionary(uniqueKeysWithValues: allCases.map { ($0, PhantomOutline.sample($0.path)) })

    /// The form as the design draws it, before it is sampled.
    public var path: CGPath {
        switch self {
        case .arrow:
            return PhantomGeometry.poly([CGPoint(x: 4, y: 3.5), CGPoint(x: 20.5, y: 10.5), CGPoint(x: 13.5, y: 13.5), CGPoint(x: 10.5, y: 20.5)]).cgPath
        case .finger:
            return PhantomGeometry.oval(center: CGPoint(x: 4, y: 3.5), radiusX: 10, radiusY: 10).cgPath
        case .hand:
            return PhantomGeometry.hand
        case .beam:
            return PhantomGeometry.beam
        }
    }
}

/// The path math of the design, in its 24 × 24 box with y down. Every coordinate is rounded to hundredths as the
/// design's path strings are, so a form here is the very outline the design draws.
public enum PhantomGeometry {
    /// The design draws the hand around (4.4, 5.6) and moves it onto the hotspot.
    static let handShift = CGPoint(x: -4.4, y: -5.6)

    /// A point of the hand as the design writes it.
    static func handPoint(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        CGPoint(x: x + handShift.x, y: y + handShift.y)
    }

    /// Four curled fingers along the top, the thumb tucked against the left side, the heel of the hand below.
    static var hand: CGPath {
        let path = CGMutablePath()
        let curves: [(CGPoint, CGPoint, CGPoint)] = [
            (handPoint(4.3, 3.4), handPoint(7, 3.3), handPoint(7, 5.2)),
            (handPoint(7, 3.1), handPoint(9.8, 3.1), handPoint(9.8, 5)),
            (handPoint(9.8, 3.2), handPoint(12.6, 3.2), handPoint(12.6, 5.2)),
            (handPoint(12.6, 3.8), handPoint(15.1, 3.9), handPoint(15.1, 5.8)),
            (handPoint(15.3, 7.6), handPoint(15.2, 9.8), handPoint(14.4, 11.4)),
            (handPoint(13.6, 13), handPoint(12.2, 14), handPoint(10.4, 14)),
        ]
        path.move(to: handPoint(4.4, 5.4))
        for curve in curves {
            path.addCurve(to: curve.2, control1: curve.0, control2: curve.1)
        }
        path.addLine(to: handPoint(8, 14))
        path.addCurve(to: handPoint(4.4, 12), control1: handPoint(6.4, 14), control2: handPoint(5.2, 13.2))
        path.addLine(to: handPoint(2.4, 9.6))
        path.addCurve(to: handPoint(2.9, 7), control1: handPoint(1.6, 8.6), control2: handPoint(1.8, 7.2))
        path.addCurve(to: handPoint(4.5, 8), control1: handPoint(3.7, 6.9), control2: handPoint(4.2, 7.4))
        path.closeSubpath()
        return path
    }

    /// Where the fingers meet, and the edge of the tucked thumb.
    static var handLines: CGPath {
        let path = CGMutablePath()
        for x in [7, 9.8, 12.6] as [CGFloat] {
            path.move(to: handPoint(x, 5.4))
            path.addLine(to: handPoint(x, 7.6))
        }
        path.move(to: handPoint(4.5, 8))
        path.addCurve(to: handPoint(6.2, 10), control1: handPoint(5, 9), control2: handPoint(5.4, 9.6))
        return path
    }

    /// A text cursor with flat serifs, 6.2 wide: wider than the design's 4.4, by Bas's choice (2026-11-09).
    static var beam: CGPath {
        let path = CGMutablePath()
        path.addLines(between: [
            CGPoint(x: 0.9, y: -4.6), CGPoint(x: 7.1, y: -4.6), CGPoint(x: 7.1, y: -3.5), CGPoint(x: 4.65, y: -3.5),
            CGPoint(x: 4.65, y: 10.5), CGPoint(x: 7.1, y: 10.5), CGPoint(x: 7.1, y: 11.6), CGPoint(x: 0.9, y: 11.6),
            CGPoint(x: 0.9, y: 10.5), CGPoint(x: 3.35, y: 10.5), CGPoint(x: 3.35, y: -3.5), CGPoint(x: 0.9, y: -3.5),
        ])
        path.closeSubpath()
        return path
    }

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

    /// An ellipse from four quarter arcs, starting at the upper left.
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
