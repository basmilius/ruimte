import Foundation

/// The words of the cursor, the session bar and the menu bar item, and the accent of the cursor. The daemon writes it
/// in the language of the interface; a missing file or key falls back to English and the built-in color.
public struct OverlayConfig: Decodable, Equatable, Sendable {
    public var title = "Ruimte is using your computer"
    public var menuTitle = "Ruimte is using this Mac"
    public var pause = "Pause"
    public var resume = "Resume"
    public var takeOver = "Take over"
    public var stop = "Stop session"
    /// `#RRGGBB`.
    public var accent: String?
    /// The label beside the cursor, per state. A state without one shows no label.
    public var labels: [String: String] = [
        "click": "Click",
        "scroll": "Scroll",
        "look": "Looking",
        "think": "Working",
        "waiting": "Needs you",
        "permission": "Waiting for permission",
        "error": "Something went wrong",
        "done": "Done",
        "takeover": "You have control",
        "paused": "Paused",
        "tap": "Tap",
    ]
    /// The step line in the menu, per state; `{target}` becomes what the action is aimed at.
    public var steps: [String: String] = [
        "idle": "Ready",
        "move": "Moving to {target}",
        "hover": "Pointing at {target}",
        "click": "Clicking {target}",
        "drag": "Dragging {target}",
        "type": "Typing in {target}",
        "scroll": "Scrolling {target}",
        "look": "Looking at {target}",
        "think": "Deciding what to do next",
        "waiting": "Needs you",
        "permission": "Waiting for permission",
        "error": "Something went wrong",
        "done": "Done",
        "takeover": "You have control",
        "paused": "Paused",
        "tap": "Tapping {target}",
    ]

    public init() {}

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let words: [(CodingKeys, WritableKeyPath<OverlayConfig, String>)] = [
            (.title, \.title), (.menuTitle, \.menuTitle), (.pause, \.pause),
            (.resume, \.resume), (.takeOver, \.takeOver), (.stop, \.stop),
        ]
        for (key, path) in words {
            if let value = try? container.decodeIfPresent(String.self, forKey: key), !value.isEmpty {
                self[keyPath: path] = value
            }
        }
        accent = try? container.decodeIfPresent(String.self, forKey: .accent)
        for (key, value) in (try? container.decodeIfPresent([String: String].self, forKey: .labels)) ?? [:] where !value.isEmpty {
            labels[key] = value
        }
        for (key, value) in (try? container.decodeIfPresent([String: String].self, forKey: .steps)) ?? [:] where !value.isEmpty {
            steps[key] = value
        }
    }

    private enum CodingKeys: String, CodingKey {
        case title
        case menuTitle
        case pause
        case resume
        case takeOver
        case stop
        case accent
        case labels
        case steps
    }

    public static func load(from path: String) -> OverlayConfig {
        guard let data = FileManager.default.contents(atPath: path),
              let config = try? JSONDecoder().decode(OverlayConfig.self, from: data) else {
            return OverlayConfig()
        }
        return config
    }

    public func label(for state: PhantomState) -> String? {
        labels[state.rawValue]
    }

    public func step(for state: PhantomState, target: String?) -> String {
        let template = steps[state.rawValue] ?? state.rawValue
        guard template.contains("{target}") else {
            return template
        }
        guard let target, !target.isEmpty else {
            return template.replacingOccurrences(of: " {target}", with: "").replacingOccurrences(of: "{target}", with: "")
        }
        return template.replacingOccurrences(of: "{target}", with: target)
    }

    public var accentComponents: RGB? {
        accent.flatMap(RGB.init(hex:))
    }
}

public struct RGB: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    public init?(hex: String) {
        var digits = hex.trimmingCharacters(in: .whitespaces)
        if digits.hasPrefix("#") {
            digits.removeFirst()
        }
        guard digits.count == 6, digits.allSatisfy(\.isHexDigit), let value = UInt32(digits, radix: 16) else {
            return nil
        }
        red = Double((value >> 16) & 0xFF) / 255
        green = Double((value >> 8) & 0xFF) / 255
        blue = Double(value & 0xFF) / 255
    }
}
