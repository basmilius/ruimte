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

    /// A name without the leading words every model of its catalog shares, so a pill says `Opus 5.5` where the CLI
    /// says `Claude Opus 5.5`. Whole words only, and never all of a name.
    static func short(_ name: String, in models: [JSONValue]) -> String {
        let names = models.map { $0.text("name").split(separator: " ").map(String.init) }
        guard names.count >= 2, let first = names.first else { return name }
        var count = 0
        while names.allSatisfy({ $0.count > count + 1 && $0[count] == first[count] }) { count += 1 }
        let prefix = first.prefix(count).joined(separator: " ") + " "
        return count > 0 && name.hasPrefix(prefix) ? String(name.dropFirst(prefix.count)) : name
    }

}
