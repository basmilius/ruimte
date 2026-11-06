import Foundation
import RuimtePulsar
import RuimteShared

/// A size the way `Format.bytes` writes one, and a size a machine never reported says so.
func mobileByteCount(_ bytes: Double?, whole: Bool = false, locale: FormatLocale = .current) -> String {
    guard let bytes, bytes.isFinite, bytes >= 0 else {
        return String(localized: "Unavailable", comment: "A size the machine did not report")
    }
    return Format.bytes(bytes, whole: whole, in: locale)
}

/// Whole kilobytes, which is all a row under a file name has room for, and a decimal once it runs into megabytes.
func mobileAttachmentSize(_ bytes: Double, locale: FormatLocale = .current) -> String {
    mobileByteCount(bytes, whole: bytes < 1024 * 1024, locale: locale)
}
