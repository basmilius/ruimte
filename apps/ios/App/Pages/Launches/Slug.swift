import Foundation

/// An id or folder name made of a name, as `slugOf` and `freeSlug` in `packages/contracts` make it, so a launch typed
/// on the phone gets the id the daemon's import would have given it.
enum Slug {
    /// Lowercase letters, digits and dashes, starting with a letter or a digit, cut to `maxLength` with room left for
    /// a number. An accent folds into its letter.
    static func of(_ name: String, fallback: String, maxLength: Int = 48) -> String {
        let folded = name.decomposedStringWithCompatibilityMapping.unicodeScalars
            .filter { !(0x300...0x36F).contains($0.value) }
        var slug = ""
        var gap = false
        for scalar in String(String.UnicodeScalarView(folded)).lowercased().unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) {
                if gap && !slug.isEmpty { slug += "-" }
                gap = false
                slug.unicodeScalars.append(scalar)
            } else {
                gap = true
            }
        }
        slug = String(slug.prefix(max(0, maxLength)))
        while slug.hasSuffix("-") { slug.removeLast() }
        return slug.isEmpty ? fallback : slug
    }

    /// The slug of a name, or that slug with the first number after it that no id in `taken` has.
    static func free(_ name: String, fallback: String, taken: Set<String>, maxLength: Int = 48) -> String {
        let base = of(name, fallback: fallback, maxLength: maxLength)
        guard taken.contains(base) else { return base }
        var index = 2
        while taken.contains("\(base)-\(index)") { index += 1 }
        return "\(base)-\(index)"
    }
}
