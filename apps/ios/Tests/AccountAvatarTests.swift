import RuimtePulsar
import UIKit
import XCTest

@testable import Ruimte

final class AccountAvatarTests: XCTestCase {
    func testTheInitialIsTheNamesFirstLetterInCapitals() {
        XCTAssertEqual(AccountAvatar.initial(of: "basmilius"), "B")
        XCTAssertEqual(AccountAvatar.initial(of: "  émile"), "É")
        XCTAssertNil(AccountAvatar.initial(of: nil))
        XCTAssertNil(AccountAvatar.initial(of: " "))
    }

    func testTheNameIsTheOneAProviderToldElseTheLogin() {
        let named = Account(id: "a", provider: .github, login: "basmilius", displayName: .value("Wim"))
        XCTAssertEqual(AccountAvatar.name(of: named), "Wim")
        XCTAssertEqual(AccountAvatar.name(of: Account(id: "a", provider: .github, login: "basmilius")), "basmilius")
        XCTAssertNil(AccountAvatar.name(of: Account(id: "a", provider: .apple, login: nil, displayName: .null)))
        XCTAssertNil(AccountAvatar.name(of: nil))
    }

    func testOnlyAGitHubLoginHasAPicture() {
        XCTAssertEqual(
            AccountAvatar.pictureURL(for: Account(id: "a", provider: .github, login: "basmilius"))?.absoluteString,
            "https://github.com/basmilius.png?size=90")
        XCTAssertNil(AccountAvatar.pictureURL(for: Account(id: "a", provider: .apple, login: "bas")))
        XCTAssertNil(AccountAvatar.pictureURL(for: Account(id: "a", provider: .github, login: nil)))
        XCTAssertNil(AccountAvatar.pictureURL(for: Account(id: "a", provider: .github, login: " ")))
        XCTAssertNil(AccountAvatar.pictureURL(for: nil))
    }

    func testTheGlyphIsASquareTemplateSoTheBarDrawsACircle() {
        for initial in ["B", "W", "I", "Q"] {
            let glyph = AccountAvatar.glyph(initial)
            XCTAssertEqual(glyph.size, AccountAvatar.glyphSize)
            XCTAssertEqual(glyph.size.width, glyph.size.height)
            XCTAssertEqual(glyph.renderingMode, .alwaysTemplate)
        }
    }

    func testThePictureIsASquareInItsOwnColorsWhateverItsShape() throws {
        let wide = UIGraphicsImageRenderer(size: CGSize(width: 120, height: 60)).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 120, height: 60))
        }
        let picture = try XCTUnwrap(AccountAvatar.picture(from: try XCTUnwrap(wide.pngData())))
        XCTAssertEqual(picture.size, AccountAvatar.pictureSize)
        XCTAssertEqual(picture.renderingMode, .alwaysOriginal)
        XCTAssertNil(AccountAvatar.picture(from: Data("not an image".utf8)))
    }
}
