import Foundation
import RuimtePulsar

enum ModelName {

    /// A model id as a person reads it, for a model no catalog names: without its vendor prefix and its
    /// date, and with the version number put back together (`claude-opus-4-5` is one 4.5, not a 4 and a 5).
    static func fromSlug(_ slug: String) -> String {
        var bare = String(slug.split(separator: "/").last ?? "")
        if let dash = bare.lastIndex(of: "-") {
            let tail = bare[bare.index(after: dash)...]
            if (6...8).contains(tail.count) && tail.allSatisfy(\.isNumber) { bare = String(bare[..<dash]) }
        }
        var words: [String] = []
        for word in bare.split(separator: "-").map(String.init) {
            if let previous = words.last, previous.last?.isNumber == true, word.allSatisfy(\.isNumber) {
                words[words.count - 1] = previous + "." + word
                continue
            }
            words.append(word)
        }
        return words.map { $0 == "gpt" ? "GPT" : $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }

    /// What the CLI calls the model, so every surface says the same thing; a slug it no longer offers is read as one.
    static func of(_ slug: String, in models: [JSONValue]) -> String {
        models.first { $0.text("slug") == slug }?["name"]?.stringValue ?? fromSlug(slug)
    }

}
