import Observation
import RuimtePulsar
import SwiftUI
import UIKit

/// The account's picture, else its initial, else the person mark while nobody is signed in, as the way into Settings.
/// Each is a bare image: the bar gives an image a glass circle of the system's size, which no Dynamic Type size
/// stretches, and anything else a capsule around whatever it draws.
enum AccountAvatar {
    static let glyphSize = CGSize(width: 20, height: 20)
    /// Larger than an icon so the picture fills most of the glass circle, which stays a ring of glass around it.
    static let pictureSize = CGSize(width: 30, height: 30)
    @MainActor private static var glyphs: [String: UIImage] = [:]

    /// The name the desktop takes the letter from: the one a provider told, else the login.
    static func name(of account: Account?) -> String? {
        guard let account else { return nil }
        if case .value(let name) = account.displayName { return name }
        return account.login
    }

    static func initial(of name: String?) -> String? {
        name?.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() }
    }

    /// GitHub serves every login's picture at this address; Apple hands out none.
    static func pictureURL(for account: Account?) -> URL? {
        guard let account, account.provider == .github,
            let login = account.login?.trimmingCharacters(in: .whitespacesAndNewlines), !login.isEmpty,
            let path = login.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(["-", "_"]))
        else { return nil }
        let scale = Int((pictureSize.width * 3).rounded(.up))
        return URL(string: "https://github.com/\(path).png?size=\(scale)")
    }

    @MainActor static func uiImage(for account: Account?, picture: UIImage?) -> UIImage {
        if let picture { return picture }
        guard let initial = initial(of: name(of: account)) else { return LucideIcon.uiImage(named: "circle-user-round") }
        if let image = glyphs[initial] { return image }
        let image = glyph(initial)
        glyphs[initial] = image
        return image
    }

    /// The letter in the weight and size of a bar button's title, centered on its capitals so a letter without a
    /// descender sits in the middle of the circle.
    static func glyph(_ initial: String) -> UIImage {
        let font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        let text = NSAttributedString(string: initial, attributes: [.font: font, .foregroundColor: UIColor.black])
        let width = text.size().width
        let baseline = (glyphSize.height + font.capHeight) / 2
        return UIGraphicsImageRenderer(size: glyphSize).image { _ in
            text.draw(at: CGPoint(x: (glyphSize.width - width) / 2, y: baseline - font.ascender))
        }
        .withRenderingMode(.alwaysTemplate)
    }

    /// The downloaded picture filled into a circle, in its own colors: a template would draw it as one flat tint.
    static func picture(from data: Data) -> UIImage? {
        guard let source = UIImage(data: data), source.size.width > 0, source.size.height > 0 else { return nil }
        let side = min(source.size.width, source.size.height)
        let scale = pictureSize.width / side
        let drawn = CGSize(width: source.size.width * scale, height: source.size.height * scale)
        let origin = CGPoint(x: (pictureSize.width - drawn.width) / 2, y: (pictureSize.height - drawn.height) / 2)
        return UIGraphicsImageRenderer(size: pictureSize).image { _ in
            UIBezierPath(ovalIn: CGRect(origin: .zero, size: pictureSize)).addClip()
            source.draw(in: CGRect(origin: origin, size: drawn))
        }
        .withRenderingMode(.alwaysOriginal)
    }
}

/// The account pictures the avatar draws. A picture is kept in Caches, so the bar shows it at once on the next
/// launch, and asked again once per launch, so a new one arrives.
@MainActor @Observable
final class AccountPictures {
    static let shared = AccountPictures()
    private var pictures: [URL: UIImage] = [:]
    @ObservationIgnored private var asked: Set<URL> = []

    func picture(for account: Account?) -> UIImage? {
        AccountAvatar.pictureURL(for: account).flatMap { pictures[$0] }
    }

    func load(for account: Account?) async {
        guard let url = AccountAvatar.pictureURL(for: account), asked.insert(url).inserted else { return }
        let file = Self.cacheFile(for: url)
        if pictures[url] == nil, let file, let data = try? Data(contentsOf: file),
            let picture = AccountAvatar.picture(from: data)
        {
            pictures[url] = picture
        }
        guard let (data, response) = try? await URLSession.shared.data(from: url),
            (response as? HTTPURLResponse)?.statusCode == 200, let picture = AccountAvatar.picture(from: data)
        else {
            // Offline, or a login GitHub no longer knows: the letter or the kept picture stands in, and the next
            // account change or launch asks again.
            asked.remove(url)
            return
        }
        pictures[url] = picture
        if let file {
            try? FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: file, options: .atomic)
        }
    }

    private static func cacheFile(for url: URL) -> URL? {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            return nil
        }
        return caches.appending(path: "account-pictures").appending(path: url.deletingPathExtension().lastPathComponent)
    }
}
