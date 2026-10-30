import Foundation

struct ChatWordReveal {
    private(set) var source: String
    private(set) var characters: [Character]
    private(set) var shown: String
    private(set) var shownCount: Int
    private(set) var position: Double

    init(_ text: String) {
        source = text
        characters = Array(text)
        shown = text
        shownCount = characters.count
        position = Double(shownCount)
    }

    mutating func update(_ text: String) {
        let previousBytes = source.utf8.count
        guard text.utf8.count >= previousBytes, text.utf8.starts(with: source.utf8) else {
            self = ChatWordReveal(text)
            return
        }
        guard text.utf8.count > previousBytes else { return }

        let suffix = String(decoding: text.utf8.dropFirst(previousBytes), as: UTF8.self)
        let previousCount = characters.count
        let last = characters.popLast()
        // A new scalar can extend the last grapheme, including a visible accent or emoji sequence.
        let tail = Array((last.map(String.init) ?? "") + suffix)
        characters.append(contentsOf: tail)
        source = text

        if let last, tail.first != last, shownCount == previousCount {
            shown = String(characters.prefix(shownCount))
        }
    }

    mutating func advance(elapsed: Double, finished: Bool) {
        position = ChatReveal.advance(position, target: characters.count, elapsed: elapsed, finished: finished)
        let next = ChatReveal.boundaryCount(characters, position: Int(position), finished: finished)
        if next > shownCount {
            shown += String(characters[shownCount..<next])
            shownCount = next
        }
    }
}
