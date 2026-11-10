import Foundation

/// Where a launch runs, as `launchCwdOf` in `packages/contracts` reads it. A machine may speak Windows paths, so both
/// kinds of separator count and the folder's own kind is the one the result keeps.
enum LaunchPath {
    /// The folder a launch runs in, absolute: `cwd` as the launch or its private overlay names it, relative to the
    /// project folder unless it names a root of its own.
    static func cwd(_ named: String?, in folder: String) -> String {
        let cwd = JSText.trimmed(named ?? "")
        return collapsed(isAbsolute(cwd) ? cwd : folder + separator(of: folder) + cwd)
    }

    /// A path that starts with a drive letter or a backslash is the only one whose separator is not a slash.
    static func separator(of root: String) -> String {
        let scalars = Array(root.unicodeScalars)
        let drive = scalars.count >= 3 && isLetter(scalars[0]) && scalars[1] == ":" && scalars[2] == "\\"
        let share = scalars.count >= 2 && scalars[0] == "\\" && scalars[1] == "\\"
        return drive || share ? "\\" : "/"
    }

    private static func isAbsolute(_ path: String) -> Bool {
        let scalars = Array(path.unicodeScalars)
        if let first = scalars.first, isSeparator(first) { return true }
        return scalars.count >= 3 && isLetter(scalars[0]) && scalars[1] == ":" && isSeparator(scalars[2])
    }

    private static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar)
    }

    private static func isSeparator(_ scalar: Unicode.Scalar) -> Bool { scalar == "/" || scalar == "\\" }

    /// The path with its `.` and `..` segments resolved and no separator left at the end, except a root's own.
    private static func collapsed(_ path: String) -> String {
        let scalars = Array(path.unicodeScalars)
        var rootEnd = 0
        if scalars.count >= 2, isLetter(scalars[0]), scalars[1] == ":" { rootEnd = 2 }
        while rootEnd < scalars.count, isSeparator(scalars[rootEnd]) { rootEnd += 1 }
        let separator = separator(of: path)
        let root = String(String.UnicodeScalarView(scalars[..<rootEnd]))
            .replacingOccurrences(of: "/", with: separator).replacingOccurrences(of: "\\", with: separator)
        var segments: [String] = []
        var current = String.UnicodeScalarView()
        func finish() {
            let segment = String(current)
            current = String.UnicodeScalarView()
            if segment == ".." {
                _ = segments.popLast()
            } else if !segment.isEmpty && segment != "." {
                segments.append(segment)
            }
        }
        for scalar in scalars[rootEnd...] {
            if isSeparator(scalar) { finish() } else { current.append(scalar) }
        }
        finish()
        return root + segments.joined(separator: separator)
    }
}
