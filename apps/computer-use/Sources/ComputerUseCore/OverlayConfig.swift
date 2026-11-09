import Foundation

/// The words of the menu bar item. The daemon writes it in the language of the interface; a missing file or key
/// falls back to English.
public struct OverlayConfig: Decodable, Equatable, Sendable {
    public var menuTitle = "Ruimte is using this Mac"
    public var pause = "Pause"
    public var resume = "Resume"
    public var takeOver = "Take over"
    public var stop = "Stop session"
    /// The menu while the agent works behind the person's work; `{app}` is the app it works in.
    public var backgroundMenuTitle = "Ruimte is using {app} in the background"
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
            (.menuTitle, \.menuTitle), (.pause, \.pause), (.resume, \.resume),
            (.takeOver, \.takeOver), (.stop, \.stop), (.backgroundMenuTitle, \.backgroundMenuTitle),
        ]
        for (key, path) in words {
            if let value = try? container.decodeIfPresent(String.self, forKey: key), !value.isEmpty {
                self[keyPath: path] = value
            }
        }
        for (key, value) in (try? container.decodeIfPresent([String: String].self, forKey: .steps)) ?? [:] where !value.isEmpty {
            steps[key] = value
        }
    }

    private enum CodingKeys: String, CodingKey {
        case menuTitle
        case pause
        case resume
        case takeOver
        case stop
        case backgroundMenuTitle
        case steps
    }

    public static func load(from path: String) -> OverlayConfig {
        guard let data = FileManager.default.contents(atPath: path),
              let config = try? JSONDecoder().decode(OverlayConfig.self, from: data) else {
            return OverlayConfig()
        }
        return config
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

    /// In the background it names the app, which the person does not see being operated.
    public func menuTitle(background app: String?) -> String {
        app.map { backgroundMenuTitle.replacingOccurrences(of: "{app}", with: $0) } ?? menuTitle
    }
}
