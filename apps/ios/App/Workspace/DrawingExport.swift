import RuimtePulsar
import SwiftUI
import UIKit

@MainActor enum DrawingPalette {
    static let names = ["ink", "muted", "accent", "red", "orange", "yellow", "green", "blue", "purple", "pink"]
    static func color(_ name: String) -> UIColor {
        switch name {
        case "muted": .secondaryLabel
        case "red": .systemRed
        case "orange": .systemOrange
        case "yellow": .systemYellow
        case "green": .systemGreen
        case "blue": .systemBlue
        case "purple", "accent": .systemPurple
        case "pink": .systemPink
        default: .label
        }
    }
    static func font(_ name: String, size: Double) -> UIFont {
        switch name {
        case "mono": .monospacedSystemFont(ofSize: size, weight: .regular)
        case "hand": UIFont(name: "ChalkboardSE-Regular", size: size) ?? .systemFont(ofSize: size)
        default: .systemFont(ofSize: size)
        }
    }
}

enum DrawingExportFormat: String { case png, svg }
struct DrawingShare: Identifiable {
    let id = UUID()
    let url: URL
}
struct DrawingShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}

}

@MainActor enum DrawingExport {
    static func data(elements: [JSONValue], format: DrawingExportFormat, background: Bool, dark: Bool) async throws
        -> Data
    {
        let scene = try await LocalDocumentRenderer.shared.render(
            kind: "drawing",
            document: .object(["version": .number(1), "rev": .number(0), "elements": .array(elements)]))
        let traits = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)
        if format == .svg { return Data(svg(scene: scene, background: background, traits: traits).utf8) }
        let rect = scene["bounds"] ?? .object([:])
        let size = CGSize(width: max(1, rect.number("w") + 64), height: max(1, rect.number("h") + 64))
        // Bound raster exports to 16 megapixels while retaining the full drawing and vector export.
        let scale = min(2, 4096 / max(size.width, size.height))
        let surface = SceneSurface()
        surface.overrideUserInterfaceStyle = dark ? .dark : .light
        surface.configure(scene)
        surface.show(surface.bounds, scale: scale)
        surface.layoutIfNeeded()
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = background
        var data = Data()
        traits.performAsCurrent {
            data = UIGraphicsImageRenderer(size: size, format: format).pngData { context in
                if background {
                    UIColor.systemBackground.setFill()
                    context.fill(CGRect(origin: .zero, size: size))
                }
                surface.layer.sublayers?.forEach { $0.displayIfNeeded() }
                surface.layer.render(in: context.cgContext)
            }
        }
        return data
    }

    static func svg(scene: JSONValue, background: Bool, traits: UITraitCollection) -> String {
        let bounds = scene["bounds"] ?? .object([:])
        let width = max(1, bounds.number("w") + 64)
        let height = max(1, bounds.number("h") + 64)
        var body = ""
        if background {
            body += "<rect width=\"100%\" height=\"100%\" fill=\"\(rgba(UIColor.systemBackground, traits: traits))\"/>"
        }
        body += "<g transform=\"translate(\(32 - bounds.number("x")) \(32 - bounds.number("y")))\">"
        for element in scene.list("elements") {
            let centerX = element.number("centerX")
            let centerY = element.number("centerY")
            body +=
                "<g transform=\"translate(\(element.number("x") + centerX) \(element.number("y") + centerY)) rotate(\(element.number("angle") * 180 / .pi)) translate(\(-centerX) \(-centerY))\">"
            for path in element.list("paths") {
                let fill = paint(path["fill"], traits: traits)
                let stroke = paint(path["stroke"], traits: traits)
                let dash = path.list("dash").compactMap(\.numberValue).map { String($0) }.joined(separator: " ")
                body +=
                    "<path d=\"\(escape(path.text("d")))\" fill=\"\(fill)\" stroke=\"\(stroke)\" stroke-width=\"\(path.number("strokeWidth", fallback: 1))\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-dasharray=\"\(dash)\"/>"
            }
            for text in element.list("text") {
                let font: String
                switch text.text("font") {
                case "mono": font = "monospace"
                case "hand": font = "Chalkboard SE, cursive"
                default: font = "system-ui, sans-serif"
                }
                let anchor =
                    text.text("align") == "center" ? "middle" : (text.text("align") == "right" ? "end" : "start")
                body +=
                    "<text x=\"\(text.number("x"))\" y=\"\(text.number("y"))\" fill=\"\(paint(text["color"], traits: traits))\" font-family=\"\(font)\" font-size=\"\(text.number("size", fallback: 16))\" font-weight=\"\(text["bold"] == .bool(true) ? "bold" : "normal")\" text-anchor=\"\(anchor)\">\(escape(text.text("text")))</text>"
            }
            body += "</g>"
        }
        return
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"\(width)\" height=\"\(height)\" viewBox=\"0 0 \(width) \(height)\">\(body)</g></svg>"
    }
    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }
    private static func paint(_ value: JSONValue?, traits: UITraitCollection) -> String {
        guard let value, value != .null else { return "none" }
        var color = DrawingPalette.color(value.text("tone"))
        switch value.text("palette") {
        case "paper": color = color.withAlphaComponent(traits.userInterfaceStyle == .dark ? 0.22 : 0.12)
        case "edge": color = color.withAlphaComponent(0.45)
        default: break
        }
        return rgba(color, traits: traits)
    }
    private static func rgba(_ color: UIColor, traits: UITraitCollection) -> String {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        color.resolvedColor(with: traits).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        return
            "rgba(\(Int((red * 255).rounded())),\(Int((green * 255).rounded())),\(Int((blue * 255).rounded())),\(alpha))"
    }
}
