import CoreGraphics
import Foundation
import RuimtePulsar

struct DrawingStyle: Equatable {
    var stroke = "ink"
    var strokeWidth = 2
    var strokeStyle = "solid"
    var fill = "none"
    var fillColor = "blue"
    var noteColor = "yellow"
    var roughness = 1
    var font = "hand"
    var textSize = 20
    var align = "left"

    func apply(to element: JSONValue, keys: Set<String>? = nil) -> JSONValue {
        let kind = element.text("kind")
        let written = ["text", "note"].contains(kind)
        let fields: [String: JSONValue] = [
            "stroke": .string(stroke), "strokeWidth": .number(Double(strokeWidth)), "strokeStyle": .string(strokeStyle),
            "fill": .string(kind == "note" ? "solid" : (["line", "freehand", "text"].contains(kind) ? "none" : fill)),
            "fillColor": .string(kind == "note" ? noteColor : fillColor), "roughness": .number(Double(roughness)),
            "font": .string(font), "size": .number(Double(textSize)), "align": .string(align),
        ]
        return fields.reduce(element) { result, field in
            let source =
                field.key == "size"
                ? "textSize" : (field.key == "fillColor" && kind == "note" ? "noteColor" : field.key)
            guard keys == nil || keys!.contains(source), written || !["font", "size", "align"].contains(field.key)
            else { return result }
            return result.setting(field.key, field.value)
        }
    }

    mutating func adopt(_ element: JSONValue) {
        stroke = element.text("stroke", fallback: stroke)
        strokeWidth = Int(element.number("strokeWidth", fallback: Double(strokeWidth)))
        strokeStyle = element.text("strokeStyle", fallback: "solid")
        roughness = Int(element.number("roughness", fallback: 1))
        if element.text("kind") == "note" {
            noteColor = element.text("fillColor", fallback: noteColor)
        } else {
            fill = element.text("fill", fallback: "none")
            fillColor = element.text("fillColor", fallback: fillColor)
        }
        if ["text", "note"].contains(element.text("kind")) {
            font = element.text("font", fallback: "hand")
            textSize = Int(element.number("size", fallback: 20))
            align = element.text("align", fallback: "left")
        }
    }
}

enum DrawingTool: String, CaseIterable, Identifiable {
    case pan = "Pan"
    case select = "Select"
    case rect = "Rectangle"
    case diamond = "Diamond"
    case ellipse = "Ellipse"
    case arrow = "Arrow"
    case line = "Line"
    case pen = "Pen"
    case text = "Text"
    case note = "Sticky note"
    case eraser = "Eraser"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .pan: "hand"
        case .select: "mouse-pointer-2"
        case .rect: "square"
        case .diamond: "diamond"
        case .ellipse: "circle"
        case .arrow: "move-up-right"
        case .line: "minus"
        case .pen: "pen-tool"
        case .text: "type"
        case .note: "sticky-note"
        case .eraser: "eraser"
        }
    }
    var shortcut: String {
        switch self {
        case .pan: "h"
        case .select: "v"
        case .rect: "r"
        case .diamond: "d"
        case .ellipse: "o"
        case .arrow: "a"
        case .line: "l"
        case .pen: "p"
        case .text: "t"
        case .note: "n"
        case .eraser: "e"
        }
    }
}

enum DrawingGeometry {
    static func box(_ element: JSONValue, rotated: Bool = true) -> CGRect {
        let rect = CGRect(
            x: element.number("x"), y: element.number("y"), width: element.number("w"), height: element.number("h")
        ).standardized
        guard rotated, element.number("angle") != 0 else { return rect }
        let center = CGPoint(
            x: element.number("x") + element.number("w") / 2, y: element.number("y") + element.number("h") / 2)
        let points = corners(rect).map { rotate($0, around: center, angle: element.number("angle")) }
        return bounds(points)
    }
    static func bounds(_ elements: [JSONValue]) -> CGRect? {
        elements.map { box($0) }.reduce(nil) { result, rect in result.map { $0.union(rect) } ?? rect }
    }
    static func bounds(_ points: [CGPoint]) -> CGRect {
        guard let first = points.first else { return .zero }
        let left = points.map(\.x).min() ?? first.x
        let top = points.map(\.y).min() ?? first.y
        return CGRect(
            x: left, y: top, width: (points.map(\.x).max() ?? first.x) - left,
            height: (points.map(\.y).max() ?? first.y) - top)
    }
    static func corners(_ rect: CGRect) -> [CGPoint] {
        [
            CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
            CGPoint(x: rect.maxX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.maxY),
        ]
    }
    static func rotate(_ point: CGPoint, around center: CGPoint, angle: Double) -> CGPoint {
        let dx = point.x - center.x
        let dy = point.y - center.y
        return CGPoint(x: center.x + dx * cos(angle) - dy * sin(angle), y: center.y + dx * sin(angle) + dy * cos(angle))
    }
    static func moved(_ element: JSONValue, by delta: CGPoint) -> JSONValue {
        element.setting("x", .number(element.number("x") + delta.x)).setting(
            "y", .number(element.number("y") + delta.y))
    }
    static func scaled(_ element: JSONValue, from source: CGRect, to target: CGRect) -> JSONValue {
        let scaleX = source.width == 0 ? 1 : target.width / source.width
        let scaleY = source.height == 0 ? 1 : target.height / source.height
        var result = element.setting("x", .number(target.minX + (element.number("x") - source.minX) * scaleX))
            .setting("y", .number(target.minY + (element.number("y") - source.minY) * scaleY))
            .setting("w", .number(element.number("w") * scaleX)).setting("h", .number(element.number("h") * scaleY))
        if element["points"] != nil {
            result = result.setting(
                "points",
                .array(
                    element.list("points").map { value in
                        guard var point = value.arrayValue, point.count >= 2 else { return value }
                        point[0] = .number((point[0].numberValue ?? 0) * scaleX)
                        point[1] = .number((point[1].numberValue ?? 0) * scaleY)
                        return .array(point)
                    }))
        }
        if ["text", "note"].contains(element.text("kind")) {
            result = result.setting(
                "size",
                .number(
                    min(96, max(12, (element.number("size", fallback: 20) * min(abs(scaleX), abs(scaleY))).rounded()))))
            if element.text("kind") == "text" { result = result.setting("sized", .bool(true)) }
        }
        return result
    }
    static func create(
        tool: DrawingTool, from start: CGPoint, to end: CGPoint, style: DrawingStyle, id: String,
        constrained: Bool = false
    ) -> JSONValue? {
        var end = end
        if constrained {
            if [.line, .arrow].contains(tool) {
                let angle = (atan2(end.y - start.y, end.x - start.x) / (.pi / 12)).rounded() * (.pi / 12)
                let length = hypot(end.x - start.x, end.y - start.y)
                end = CGPoint(x: start.x + cos(angle) * length, y: start.y + sin(angle) * length)
            } else {
                let size = max(abs(end.x - start.x), abs(end.y - start.y))
                end = CGPoint(
                    x: start.x + (end.x < start.x ? -size : size), y: start.y + (end.y < start.y ? -size : size))
            }
        }
        var rect = bounds([start, end])
        let kind: String
        switch tool {
        case .rect: kind = "rect"
        case .diamond: kind = "diamond"
        case .ellipse: kind = "ellipse"
        case .line, .arrow:
            kind = "line"
            rect = CGRect(x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y)
        case .text: kind = "text"
        case .note: kind = "note"
        default: return nil
        }
        var element: JSONValue = .object([
            "id": .string(id), "kind": .string(kind),
            "seed": .number(Double(id.utf8.reduce(UInt32(2_166_136_261)) { ($0 ^ UInt32($1)) &* 16_777_619 })),
            "x": .number(rect.origin.x), "y": .number(rect.origin.y), "w": .number(rect.size.width),
            "h": .number(rect.size.height),
        ])
        if kind == "line" {
            element = element.setting(
                "points",
                .array([
                    .array([.number(0), .number(0)]), .array([.number(end.x - start.x), .number(end.y - start.y)]),
                ]))
            if tool == .arrow { element = element.setting("arrowEnd", .bool(true)) }
        }
        if ["text", "note"].contains(kind) { element = element.setting("text", .string("")) }
        return style.apply(to: element)
    }
    static func defaultShape(_ element: JSONValue) -> JSONValue {
        guard abs(element.number("w")) < 3, abs(element.number("h")) < 3 else { return element }
        let kind = element.text("kind")
        if kind == "line" {
            return element.setting("w", .number(160)).setting(
                "points", .array([.array([.number(0), .number(0)]), .array([.number(160), .number(0)])]))
        }
        return element.setting("w", .number(kind == "text" ? 240 : 160)).setting(
            "h", .number(kind == "text" ? element.number("size", fallback: 20) * 1.25 : (kind == "note" ? 160 : 100)))
    }
    static func hit(_ element: JSONValue, point: CGPoint, tolerance: CGFloat = 8) -> Bool {
        guard element["locked"] != .bool(true) else { return false }
        let center = CGPoint(
            x: element.number("x") + element.number("w") / 2, y: element.number("y") + element.number("h") / 2)
        let point = rotate(point, around: center, angle: -element.number("angle"))
        let local = CGPoint(x: point.x - element.number("x"), y: point.y - element.number("y"))
        if ["freehand", "line"].contains(element.text("kind")) {
            let points = element.list("points").compactMap { value -> CGPoint? in
                guard let row = value.arrayValue, row.count >= 2 else { return nil }
                return CGPoint(x: row[0].numberValue ?? 0, y: row[1].numberValue ?? 0)
            }
            if points.count == 1 { return hypot(local.x - points[0].x, local.y - points[0].y) <= tolerance }
            return zip(points, points.dropFirst()).contains { start, end in
                let dx = end.x - start.x
                let dy = end.y - start.y
                let length = dx * dx + dy * dy
                let progress =
                    length == 0 ? 0 : min(1, max(0, ((local.x - start.x) * dx + (local.y - start.y) * dy) / length))
                return hypot(local.x - start.x - progress * dx, local.y - start.y - progress * dy) <= tolerance
            }
        }
        let rect = CGRect(x: 0, y: 0, width: element.number("w"), height: element.number("h")).standardized.insetBy(
            dx: -tolerance, dy: -tolerance)
        guard rect.contains(local) else { return false }
        if element.text("kind") == "ellipse" {
            let rx = max(1, rect.width / 2)
            let ry = max(1, rect.height / 2)
            return pow((local.x - rect.midX) / rx, 2) + pow((local.y - rect.midY) / ry, 2) <= 1
        }
        if element.text("kind") == "diamond" {
            return abs(local.x - rect.midX) / max(1, rect.width / 2) + abs(local.y - rect.midY)
                / max(1, rect.height / 2) <= 1
        }
        return true
    }
}
