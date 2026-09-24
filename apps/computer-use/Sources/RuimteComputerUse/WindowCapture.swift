import ComputerUseCore
import CoreGraphics
import Foundation
import ImageIO
@preconcurrency import ScreenCaptureKit
import UniformTypeIdentifiers

enum WindowCapture {
    /// A capture and the window it was taken of, for asking the window server about that window afterwards.
    struct Shot {
        let result: CaptureResult
        let windowID: CGWindowID
        let onScreen: Bool
    }

    /// Captures a window by itself, so what covers it never shows and a window behind the person's work is
    /// captured whole; a minimized one gives its last frame. A sheet, an open menu or a popover is a window of
    /// its own and cannot be captured alone: a sheet comes back over its parent shrunk into the sheet's size.
    /// With one of those up, the app's windows are composed on their display instead, which only an app's windows
    /// on screen can be, and which leaves the windows of other apps out all the same. The overlay is in neither.
    static func capture(pid: pid_t, windowFrame: CGRect, label: String, maxWidth: CGFloat, directory: URL) async throws -> Shot {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        let own = content.windows.filter { $0.owningApplication?.processID == pid }
        guard let root = rootWindow(among: own, frame: windowFrame) else {
            throw AgentError("no window of this app to capture (on another Space?)")
        }
        let above = root.isOnScreen ? windowsAbove(root.windowID, pid: pid) : []
        let extras = above.compactMap { id in own.first { $0.windowID == id } }
        let image: CGImage
        let region: CGRect
        if extras.isEmpty {
            region = root.frame
            let filter = SCContentFilter(desktopIndependentWindow: root)
            let scale = min(CGFloat(filter.pointPixelScale), maxWidth / max(1, region.width))
            let configuration = configured(size: region.size, scale: scale)
            configuration.ignoreShadowsSingleWindow = true
            image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        } else {
            (image, region) = try await captureComposed([root] + extras, content: content, maxWidth: maxWidth)
        }
        let path = try writePNG(image, label: label, directory: directory)
        let result = CaptureResult(path: path, pixelWidth: image.width, pixelHeight: image.height, origin: region.origin, pointSize: region.size)
        return Shot(result: result, windowID: root.windowID, onScreen: root.isOnScreen)
    }

    /// The windows as their display shows them, over the area of the first; menus and popovers may hang outside it.
    private static func captureComposed(_ windows: [SCWindow], content: SCShareableContent, maxWidth: CGFloat) async throws -> (CGImage, CGRect) {
        let rootFrame = windows[0].frame
        let center = CGPoint(x: rootFrame.midX, y: rootFrame.midY)
        guard let display = content.displays.first(where: { $0.frame.contains(center) }) ?? content.displays.first else {
            throw AgentError("no display to capture from")
        }
        var region = rootFrame
        for window in windows.dropFirst() where window.frame.intersects(display.frame) {
            region = region.union(window.frame)
        }
        region = region.intersection(display.frame).integral
        guard !region.isNull, region.width >= 1, region.height >= 1 else {
            throw AgentError("the window is not on a display that can be captured")
        }
        let filter = SCContentFilter(display: display, including: windows)
        let scale = min(CGFloat(filter.pointPixelScale), maxWidth / region.width)
        let configuration = configured(size: region.size, scale: scale)
        configuration.sourceRect = region.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
        return (try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration), region)
    }

    private static func configured(size: CGSize, scale: CGFloat) -> SCStreamConfiguration {
        let configuration = SCStreamConfiguration()
        configuration.width = max(1, Int((size.width * scale).rounded()))
        configuration.height = max(1, Int((size.height * scale).rounded()))
        configuration.showsCursor = false
        configuration.backgroundColor = CGColor.clear
        return configuration
    }

    /// The window the accessibility frame belongs to: the normal window of the app nearest to that frame, one on screen first.
    private static func rootWindow(among windows: [SCWindow], frame: CGRect) -> SCWindow? {
        let distance = { (window: SCWindow) -> CGFloat in
            abs(window.frame.minX - frame.minX) + abs(window.frame.minY - frame.minY)
                + abs(window.frame.width - frame.width) + abs(window.frame.height - frame.height)
        }
        return windows
            .filter { $0.windowLayer == 0 && $0.frame.intersects(frame) }
            .min { (distance($0), $0.isOnScreen ? 0 : 1) < (distance($1), $1.isOnScreen ? 0 : 1) }
    }

    /// The app's windows in front of the window: its sheets, open menus and popovers.
    private static func windowsAbove(_ id: CGWindowID, pid: pid_t) -> [CGWindowID] {
        let list = CGWindowListCopyWindowInfo([.optionOnScreenAboveWindow], id) as? [[String: Any]] ?? []
        return list.compactMap { entry in
            guard (entry[kCGWindowOwnerPID as String] as? Int).map(pid_t.init) == pid else {
                return nil
            }
            return (entry[kCGWindowNumber as String] as? Int).map(CGWindowID.init)
        }
    }

    /// Every window on screen, front to back.
    static func onScreenStack() -> [StackedWindow] {
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return list.compactMap { entry in
            guard let id = entry[kCGWindowNumber as String] as? Int,
                  let pid = entry[kCGWindowOwnerPID as String] as? Int,
                  let bounds = entry[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: bounds) else {
                return nil
            }
            return StackedWindow(
                id: CGWindowID(id),
                pid: pid_t(pid),
                layer: entry[kCGWindowLayer as String] as? Int ?? 0,
                frame: frame,
                alpha: entry[kCGWindowAlpha as String] as? Double ?? 1
            )
        }
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
