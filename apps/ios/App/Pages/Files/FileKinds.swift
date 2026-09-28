import Foundation
import RuimtePulsar
import UniformTypeIdentifiers

/// What the app knows about a file from its name or its mime alone, before any byte of it arrives.
enum FileKinds {
    private static let codeExtensions: Set<String> = [
        "astro", "c", "cc", "cjs", "cpp", "cs", "css", "cts", "dart", "ex", "exs", "go", "graphql", "h", "hpp", "htm",
        "html", "java", "js", "jsx", "kt", "kts", "less", "lua", "m", "mjs", "mm", "mts", "php", "pl", "prisma", "py",
        "r", "rb", "rs", "scala", "scss", "sql", "svelte", "swift", "ts", "tsx", "vue", "zig",
    ]

    /// The Lucide mark of a row in a folder listing. A listing carries no mime, so the extension decides; the system's
    /// type table knows the media formats, and the code table goes first because it claims `ts` as a video stream.
    static func icon(name: String, kind: String) -> String {
        switch kind {
        case "directory": return "folder"
        case "symlink": return "file-symlink"
        default: break
        }
        let ext = (name as NSString).pathExtension.lowercased()
        if codeExtensions.contains(ext) { return "file-code" }
        switch ext {
        case "diff", "patch": return "file-diff"
        case "key", "pem", "crt", "cer", "p12": return "file-key"
        case "csv", "tsv": return "file-spreadsheet"
        case "ttf", "otf", "woff", "woff2": return "file-type"
        default: break
        }
        guard !ext.isEmpty, let type = UTType(filenameExtension: ext) else { return "file" }
        if type.conforms(to: .json) { return "file-braces" }
        if type.conforms(to: .shellScript) { return "file-terminal" }
        if type.conforms(to: .image) { return "file-image" }
        if type.conforms(to: .audio) { return "file-music" }
        if type.conforms(to: .audiovisualContent) { return "file-play" }
        if type.conforms(to: .archive) { return "file-archive" }
        if type.conforms(to: .spreadsheet) { return "file-spreadsheet" }
        if type.conforms(to: .font) { return "file-type" }
        if type.conforms(to: .sourceCode) { return "file-code" }
        if type.conforms(to: .pdf) || type.conforms(to: .text) { return "file-text" }
        return "file"
    }

    /// The highlight.js name for the highlighter id `fs.read` sends, which follows the desktop's highlighter. Most
    /// ids are the same in both; these are the ones highlight.js lacks or calls otherwise.
    static func highlightLanguage(_ language: String?) -> String {
        guard let language, !language.isEmpty else { return "plaintext" }
        switch language {
        case "vue", "svelte", "astro": return "xml"
        case "shellscript", "fish", "dotenv": return "bash"
        case "json5": return "json"
        case "mdx": return "markdown"
        case "ignore": return "plaintext"
        default: return language
        }
    }

    /// The bytes `bytes.read` hands over for a file: the daemon's `readMedia` serves images, video, sound and PDF only.
    static func machineServes(mime: String) -> Bool {
        mime.hasPrefix("image/") || mime.hasPrefix("video/") || mime.hasPrefix("audio/") || mime == "application/pdf"
    }

    /// Whether the app may hold the file in memory whole, which a picture, a PDF and Quick Look all need.
    static func fitsInMemory(size: Double?) -> Bool {
        (size ?? .infinity) <= WireConstants.bytesReadMaxBytes
    }

    /// A position in a recording as a player writes it: minutes and seconds, with hours only once the recording has
    /// them, so every position in one recording is written the same way.
    static func playbackClock(_ seconds: Double, total: Double, locale: Locale = .current) -> String {
        let clamped = seconds.isFinite ? max(seconds, 0) : 0
        let pattern: Duration.TimeFormatStyle.Pattern = total >= 3600 ? .hourMinuteSecond : .minuteSecond
        return Duration.seconds(clamped.rounded(.down)).formatted(.time(pattern: pattern).locale(locale))
    }
}
