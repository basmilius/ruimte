import Foundation

/// Text typed to an app's process behind the person's work. Whether a key arrived shows only in the focused value, and
/// an element that keeps its value may have taken it all the same (a terminal sends it on and clears its field), so
/// nothing refuses once a key went out: a refusal has to leave no character behind.
public enum KeysBehind {
    public static let keptValueNote = "the focused element kept its value, which a terminal does as well: if the state shows nothing typed, the app takes no keys behind the person's work and it needs front"

    /// Sends every character once and in order. Returns the note for an answer when the focused value did not change.
    /// - Parameters:
    ///   - before: The focused value before the first key, nil when the element has none to read.
    ///   - after: Reads the focused value once the app had time to take the keys.
    @MainActor
    public static func type(
        _ text: String,
        before: String?,
        send: (Character) async throws -> Void,
        after: () async -> String?
    ) async throws -> String? {
        for character in text.replacingOccurrences(of: "\r\n", with: "\n") {
            try await send(character)
        }
        guard let before else {
            return nil
        }
        return await after() == before ? keptValueNote : nil
    }
}
