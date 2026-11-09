import Foundation

/// What an element showed when a state listed it, to find it again once the app made a new accessibility object for it.
public struct ElementSignature: Hashable, Sendable {
    public let role: String
    public let label: String?
    public let identifier: String?

    public init(role: String, label: String?, identifier: String?) {
        self.role = role
        self.label = label
        self.identifier = identifier
    }

    /// How an error names the element, as a state line shows it.
    public var shown: String {
        let name = role.hasPrefix("AX") ? String(role.dropFirst(2)) : role
        return label.map { "\(name) \"\($0)\"" } ?? name
    }
}

/// Where a handle from an older state leads, now that the newest state did not list it.
public enum HandleLookup: Equatable, Sendable {
    /// The old element still answers, so it is used as it is.
    case retired
    /// The old element is gone, and the newest state lists exactly one element that looks the same.
    case moved(to: Int)
    /// The old element is gone and nothing, or more than one element, looks like it.
    case gone(ElementSignature?)

    /// Electron and web views make a new accessibility object for an element they redraw, so a handle
    /// the agent read one state ago would point at nothing; one look-alike is taken as that element.
    public static func resolve(retired signature: ElementSignature?, alive: Bool, current: [Int: ElementSignature]) -> HandleLookup {
        if alive {
            return .retired
        }
        guard let signature, signature.label != nil || signature.identifier != nil else {
            return .gone(signature)
        }
        let matches = current.filter { $0.value == signature }.map(\.key)
        return matches.count == 1 ? .moved(to: matches[0]) : .gone(signature)
    }
}
