import Foundation

/// The words of one dictation: what the recognizer settled on, and the preview it may still revise.
public struct Transcript: Sendable {
    private var settled = ""
    private var volatile = ""

    public init() {}

    public var text: String {
        (settled + volatile).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Takes one result. A final result settles its words and ends the preview they replace. A result
    /// carries its own leading space where the language puts one, so the pieces join as they come.
    public mutating func take(_ words: String, final: Bool) {
        if final {
            settled += words
            volatile = ""
        } else {
            volatile = words
        }
    }
}
