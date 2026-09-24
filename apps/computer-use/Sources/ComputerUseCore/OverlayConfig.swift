import Foundation

/// What the pill says and the accent of the virtual pointer. The daemon writes it in the language of the interface;
/// a missing file or key falls back to English and the built-in color.
public struct OverlayConfig: Decodable, Equatable, Sendable {
    public var title = "Ruimte is using your computer"
    public var hint = "Esc to stop"
    /// `#RRGGBB`.
    public var accent: String?

    public init() {}

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let title = try container.decodeIfPresent(String.self, forKey: .title), !title.isEmpty {
            self.title = title
        }
        if let hint = try container.decodeIfPresent(String.self, forKey: .hint), !hint.isEmpty {
            self.hint = hint
        }
        accent = try container.decodeIfPresent(String.self, forKey: .accent)
    }

    private enum CodingKeys: String, CodingKey {
        case title
        case hint
        case accent
    }

    public static func load(from path: String) -> OverlayConfig {
        guard let data = FileManager.default.contents(atPath: path),
              let config = try? JSONDecoder().decode(OverlayConfig.self, from: data) else {
            return OverlayConfig()
        }
        return config
    }

    public var pillText: String {
        "\(title) · \(hint)"
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
