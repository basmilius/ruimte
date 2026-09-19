import Foundation

private let byteUnits = ["B", "KB", "MB", "GB", "TB"]

/// A size the way a person says it, as the desktop client writes one in `format/number.ts`: 1024 to the unit, whole
/// bytes up to a kilobyte and one decimal above that under ten. `whole` is for a row that only has room for a round
/// number, and a size a machine never reported says so. The number follows the region, the divisor and the units
/// never do.
func mobileByteCount(_ bytes: Double?, whole: Bool = false, locale: Locale = .current) -> String {
    guard var value = bytes, value.isFinite, value >= 0 else { return "Unavailable" }
    var unit = 0
    while value >= 1024, unit < byteUnits.count - 1 {
        value /= 1024
        unit += 1
    }
    let decimals = unit > 0 && !whole && value < 10
    let number =
        decimals
        ? value.formatted(.number.precision(.fractionLength(0...1)).locale(locale))
        : value.rounded().formatted(.number.precision(.fractionLength(0)).locale(locale))
    return "\(number) \(byteUnits[unit])"
}

/// Whole kilobytes, which is all a row under a file name has room for, and a decimal once it runs into megabytes.
func mobileAttachmentSize(_ bytes: Double, locale: Locale = .current) -> String {
    mobileByteCount(bytes, whole: bytes < 1024 * 1024, locale: locale)
}
