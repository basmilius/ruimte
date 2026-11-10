import Foundation
import RuimtePulsar

extension ProviderModelOption {
    var id: String {
        switch self {
        case .select(let option): option.id
        case .boolean(let option): option.id
        }
    }
}

extension ProviderModel {
    /// The option with this id, when it is one with choices to pick from.
    func selectOption(_ id: String) -> ProviderSelectOption? {
        guard case .select(let option)? = options.first(where: { $0.id == id }) else { return nil }
        return option
    }
}

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
    static func of(_ slug: String, in models: [ProviderModel]) -> String {
        models.first { $0.slug == slug }?.name ?? fromSlug(slug)
    }

    /// A name without the leading words every model of its catalog shares, so a pill says `Opus 5.5` where the CLI
    /// says `Claude Opus 5.5`. Whole words only, and never all of a name.
    static func short(_ name: String, in models: [ProviderModel]) -> String {
        let names = models.map { $0.name.split(separator: " ").map(String.init) }
        guard names.count >= 2, let first = names.first else { return name }
        var count = 0
        while names.allSatisfy({ $0.count > count + 1 && $0[count] == first[count] }) { count += 1 }
        let prefix = first.prefix(count).joined(separator: " ") + " "
        return count > 0 && name.hasPrefix(prefix) ? String(name.dropFirst(prefix.count)) : name
    }

}

/// The line between two turns that ran on another model or effort, as `chat/logic/selection-switch.ts` on the desktop.
enum ChatSelectionSwitch {
    private static let effort = "effort"

    /// Whether the model or the effort changed; other options do not count.
    static func switches(from: ChatTurnItemSelection, to: ChatTurnItemSelection) -> Bool {
        from.model != to.model || from.options[effort] != to.options[effort]
    }

    /// Both sides of the line. A side names only what changed: the effort under the same model, the models when the
    /// effort stayed, and both otherwise. Nil when the two read the same.
    static func text(from: ChatTurnItemSelection, to: ChatTurnItemSelection, models: [ProviderModel]) -> (
        from: String, to: String
    )? {
        let fromEffort = effortLabel(from, models: models)
        let toEffort = effortLabel(to, models: models)
        if from.model == to.model {
            guard let fromEffort, let toEffort, fromEffort != toEffort else { return nil }
            return (fromEffort, toEffort)
        }
        let fromName = ModelName.short(ModelName.of(from.model, in: models), in: models)
        let toName = ModelName.short(ModelName.of(to.model, in: models), in: models)
        if fromEffort == toEffort { return (fromName, toName) }
        return (
            fromEffort.map { "\(fromName) \($0)" } ?? fromName,
            toEffort.map { "\(toName) \($0)" } ?? toName
        )
    }

    /// The effort in the catalog's words; nil for a model without one or one the catalog does not know.
    private static func effortLabel(_ selection: ChatTurnItemSelection, models: [ProviderModel]) -> String? {
        let model = models.first { $0.slug == selection.model }
        guard let option = model?.selectOption(effort) else { return nil }
        let chosen = selection.options[effort]?.stringValue
        let choice =
            option.choices.first { $0.id == chosen } ?? option.choices.first { $0.id == option.defaultChoice }
        return choice?.label
    }
}
