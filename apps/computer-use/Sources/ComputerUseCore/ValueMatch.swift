import Foundation

/// Whether an element took the value it was given. Some apps answer a set `AXValue` with success and keep the old one,
/// so the value is read back and compared.
public enum ValueMatch {
    /// A number element holds a number, so `0.5` and `.5` are the same and `true` is 1.
    public static func holds(_ readBack: String?, wanted: String, numeric: Bool) -> Bool {
        guard let readBack else {
            return false
        }
        guard numeric else {
            return readBack == wanted
        }
        guard let have = Double(readBack), let want = number(wanted) else {
            return false
        }
        return abs(have - want) <= max(1e-6, abs(want) * 1e-6)
    }

    /// The number a caller means: digits, or a word for on and off.
    public static func number(_ text: String) -> Double? {
        let lowered = text.lowercased()
        if let value = Double(text) {
            return value
        }
        if ["true", "yes", "on"].contains(lowered) {
            return 1
        }
        if ["false", "no", "off"].contains(lowered) {
            return 0
        }
        return nil
    }
}
