import ComputerUseCore
import CoreGraphics
import Foundation
import ImageIO
@preconcurrency import ScreenCaptureKit
import UniformTypeIdentifiers

enum WindowCapture {
    /// Captures the area of a window from the app's own windows, composited as on screen.
    /// A sheet, an open menu or a popover is a window of its own, so a single-window capture misses it:
    /// a sheet captured alone comes back as its parent shrunk into the sheet's size. Windows of other
    /// apps and the overlay are not in the filter, so they never show up.
    static func capture(pid: pid_t, windowFrame: CGRect, label: String, maxWidth: CGFloat, directory: URL) async throws -> CaptureResult {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let center = CGPoint(x: windowFrame.midX, y: windowFrame.midY)
        guard let display = content.displays.first(where: { $0.frame.contains(center) }) ?? content.displays.first else {
            throw AgentError("no display to capture from")
        }
        // Menus and popovers sit above the normal layer and may hang outside the window, so they widen the area.
        let floating: (SCWindow) -> Bool = { $0.windowLayer > 0 && $0.frame.intersects(display.frame) }
        let windows = content.windows.filter { window in
            window.owningApplication?.processID == pid && (window.frame.intersects(windowFrame) || floating(window))
        }
        guard windows.contains(where: { $0.frame.intersects(windowFrame) }) else {
            throw AgentError("no on-screen window of this app to capture (hidden, minimized, or on another Space?)")
        }
        var region = windowFrame
        for window in windows where floating(window) {
            region = region.union(window.frame)
        }
        region = region.intersection(display.frame).integral
        guard !region.isNull, region.width >= 1, region.height >= 1 else {
            throw AgentError("the window is not on a display that can be captured")
        }

        let filter = SCContentFilter(display: display, including: windows)
        let backingScale = CGFloat(filter.pointPixelScale)
        let scale = min(backingScale, maxWidth / region.width)
        let configuration = SCStreamConfiguration()
        configuration.sourceRect = region.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
        configuration.width = max(1, Int((region.width * scale).rounded()))
        configuration.height = max(1, Int((region.height * scale).rounded()))
        configuration.showsCursor = false
        configuration.backgroundColor = CGColor.clear

        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        let path = try writePNG(image, label: label, directory: directory)
        return CaptureResult(path: path, pixelWidth: image.width, pixelHeight: image.height, origin: region.origin, pointSize: region.size)
    }

    private static func writePNG(_ image: CGImage, label: String, directory: URL) throws -> String {
        let manager = FileManager.default
        try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        pruneOldFiles(in: directory)
        let safeLabel = label.map { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" ? $0 : "-" }
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let url = directory.appendingPathComponent("\(String(safeLabel))-\(stamp).png")
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw AgentError("could not create \(url.path)")
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw AgentError("could not write \(url.path)")
        }
        return url.path
    }

    private static func pruneOldFiles(in directory: URL) {
        let manager = FileManager.default
        let cutoff = Date().addingTimeInterval(-3600)
        let files = (try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        for file in files where file.pathExtension == "png" {
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantFuture
            if modified < cutoff {
                try? manager.removeItem(at: file)
            }
        }
    }
}
