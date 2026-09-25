import Foundation

struct FileReadOutput: Decodable {
    let path: String
    let offset: Int
    let totalLines: Int
    let content: String
    let nextOffset: Int?
    let truncated: Bool

    static func modelText(_ output: String) -> String {
        guard let page = try? JSONDecoder().decode(Self.self, from: Data(output.utf8)) else { return output }
        // JSON escaping in model context made the model copy literal backslash-n into edits.
        return """
            File: \(page.path)
            Line offset: \(page.offset). Total lines: \(page.totalLines).
            nextOffset: \(page.nextOffset.map(String.init) ?? "null"). Truncated: \(page.truncated).
            Content follows, with original line breaks. Metadata above is not part of the file.

            \(page.content)
            """
    }
}
