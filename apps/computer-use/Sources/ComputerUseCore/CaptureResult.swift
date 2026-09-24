import CoreGraphics
import Foundation

public struct CaptureResult: Sendable {
    public let path: String
    public let pixelWidth: Int
    public let pixelHeight: Int
    /// Top-left of the captured area in global screen points, the space AX and CGEvent use.
    public let origin: CGPoint
    public let pointSize: CGSize

    public init(path: String, pixelWidth: Int, pixelHeight: Int, origin: CGPoint, pointSize: CGSize) {
        self.path = path
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.origin = origin
        self.pointSize = pointSize
    }

    /// Screenshot pixels per screen point.
    public var scale: Double {
        pointSize.width > 0 ? Double(pixelWidth) / Double(pointSize.width) : 1
    }

    public func screenPoint(pixelX: Double, pixelY: Double) -> CGPoint {
        CGPoint(x: origin.x + pixelX / scale, y: origin.y + pixelY / scale)
    }

    public var json: [String: Any] {
        [
            "path": path,
            "width": pixelWidth,
            "height": pixelHeight,
            "scale": (scale * 10_000).rounded() / 10_000,
            "origin": ["x": Double(origin.x), "y": Double(origin.y)],
        ]
    }
}
