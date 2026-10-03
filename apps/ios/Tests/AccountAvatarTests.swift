import UIKit
import XCTest

@testable import Ruimte

final class AccountAvatarTests: XCTestCase {
    func testTheInitialIsTheLoginsFirstLetterInCapitals() {
        XCTAssertEqual(AccountAvatar.initial(of: "basmilius"), "B")
        XCTAssertEqual(AccountAvatar.initial(of: "  émile"), "É")
        XCTAssertNil(AccountAvatar.initial(of: nil))
        XCTAssertNil(AccountAvatar.initial(of: " "))
    }

    func testTheGlyphIsASquareTemplateSoTheBarDrawsACircle() {
        for initial in ["B", "W", "I", "Q"] {
            let glyph = AccountAvatar.glyph(initial)
            XCTAssertEqual(glyph.size, AccountAvatar.glyphSize)
            XCTAssertEqual(glyph.size.width, glyph.size.height)
            XCTAssertEqual(glyph.renderingMode, .alwaysTemplate)
        }
    }
}
