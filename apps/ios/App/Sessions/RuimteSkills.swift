import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

/// A skill Ruimte ships, as `skill.list` names it: a prompt holds `$<name>`, and a person reads it as its title.
struct RuimteSkill: Equatable, Sendable, Decodable {
    let name: String
    let title: String
    let description: String
}

/// How a token of a skill Ruimte ships reads, after `withSkillTitles` in `packages/contracts`: every one is named
/// `ruimte-<title>`, so a token reads as its title without the list of skills.
enum RuimteSkillNames {
    static let prefix = "ruimte-"

    /// The title a skill's name stands for, or nil for a name that is no skill of Ruimte's.
    static func title(of name: String) -> String? {
        guard name.hasPrefix(prefix) else { return nil }
        let title = String(name.dropFirst(prefix.count))
        return ChatDraftSyntax.matches(#"^[a-z0-9]+(?:-[a-z0-9]+)*$"#, in: title).isEmpty ? nil : title
    }

    /// How a picked skill stands in the composer: a skill of Ruimte's by its title, any other by its name.
    static func spelled(_ name: String) -> String {
        title(of: name) ?? name
    }

    /// The text with each skill Ruimte ships named by its title, `$design` for `$ruimte-design`.
    static func withTitles(_ text: String) -> String {
        let source = text as NSString
        let result = NSMutableString(string: text)
        let tokens = ChatDraftSyntax.matches(
            #"(^|[\s(\[{"'])\$ruimte-([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_:-])"#, in: text)
        for match in tokens.reversed() {
            let lead = source.substring(with: match.range(at: 1))
            let title = source.substring(with: match.range(at: 2))
            result.replaceCharacters(in: match.range, with: "\(lead)$\(title)")
        }
        return result as String
    }

    /// Ruimte's mark at the size of an icon in a line of text, which a `Text` takes only as an image of that size.
    @MainActor static func mark(size: CGFloat) -> Image {
        let key = Int(size * 10)
        if let image = marks[key] { return image }
        let side = CGSize(width: size, height: size)
        let drawn = UIImage(named: "RuimteMark").map { source in
            UIGraphicsImageRenderer(size: side).image { _ in source.draw(in: CGRect(origin: .zero, size: side)) }
                .withRenderingMode(.alwaysTemplate)
        }
        let image = drawn.map { Image(uiImage: $0).renderingMode(.template) } ?? Image(lucide: "zap", size: size)
        marks[key] = image
        return image
    }

    @MainActor private static var marks: [Int: Image] = [:]
}

/// The skills one machine ships, asked again on every new link. Empty while it loads, when it failed and on a machine
/// that does not answer `skill.list`; a failed ask keeps what the machine said last.
@MainActor @Observable
final class RuimteSkillStore {
    private(set) var skills: [RuimteSkill] = []
    @ObservationIgnored private let client: any MachineRequesting
    @ObservationIgnored private lazy var live = LiveResource(
        client: client, read: { [weak self] in await self?.read() })

    init(client: any MachineRequesting) {
        self.client = client
    }

    func start() { live.start() }

    func stop() { live.stop() }

    private struct Listed: Decodable {
        let skills: [RuimteSkill]
    }

    private func read() async {
        guard (client as? MachineFeatures)?.answers(.skillList) == true else {
            skills = []
            return
        }
        guard let listed = try? await client.request(.skillList, payload: .object([:])).decoded(as: Listed.self),
            !Task.isCancelled
        else { return }
        if listed.skills != skills { skills = listed.skills }
    }
}
