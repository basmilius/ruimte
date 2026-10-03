import UIKit
import XCTest

@testable import Ruimte

final class PhonePopGestureTests: XCTestCase {
    func testOnlyAPanTowardTheTrailingEdgeGoesBack() {
        XCTAssertTrue(PhonePopGesture.pansBack(translation: CGPoint(x: 12, y: 3), velocity: .zero, rightToLeft: false))
        XCTAssertFalse(PhonePopGesture.pansBack(translation: CGPoint(x: -12, y: 3), velocity: .zero, rightToLeft: false))
        XCTAssertFalse(PhonePopGesture.pansBack(translation: CGPoint(x: 6, y: 9), velocity: .zero, rightToLeft: false))
        XCTAssertTrue(PhonePopGesture.pansBack(translation: CGPoint(x: -12, y: 3), velocity: .zero, rightToLeft: true))
        XCTAssertTrue(
            PhonePopGesture.pansBack(translation: .zero, velocity: CGPoint(x: 300, y: 20), rightToLeft: false))
    }

    @MainActor func testAListThatOnlyScrollsDownLetsTheSwipeGoBack() {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 800))
        let list = UIScrollView(frame: container.bounds)
        list.contentSize = CGSize(width: 390, height: 4000)
        let row = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 44))
        container.addSubview(list)
        list.addSubview(row)
        XCTAssertFalse(PhonePopGesture.contentOwnsPan(at: row, within: container))
    }

    @MainActor func testContentThatPansSidewaysKeepsTheSwipe() {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 800))
        let code = UIScrollView(frame: container.bounds)
        code.contentSize = CGSize(width: 1200, height: 800)
        container.addSubview(code)
        XCTAssertTrue(PhonePopGesture.contentOwnsPan(at: code, within: container))

        let canvas = UIScrollView(frame: container.bounds)
        canvas.minimumZoomScale = 0.1
        canvas.maximumZoomScale = 8
        let node = UIView(frame: CGRect(x: 20, y: 20, width: 100, height: 100))
        canvas.addSubview(node)
        container.addSubview(canvas)
        XCTAssertTrue(PhonePopGesture.contentOwnsPan(at: node, within: container))

        let selecting = UIView(frame: container.bounds)
        selecting.addGestureRecognizer(UIPanGestureRecognizer())
        container.addSubview(selecting)
        XCTAssertTrue(PhonePopGesture.contentOwnsPan(at: selecting, within: container))
    }

    @MainActor func testSelectedTextKeepsTheSwipeForItsHandles() {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 800))
        let text = UITextView(frame: CGRect(x: 0, y: 700, width: 390, height: 44))
        text.isScrollEnabled = false
        text.text = "Hello there"
        container.addSubview(text)
        text.selectedRange = NSRange(location: 0, length: 0)
        XCTAssertFalse(PhonePopGesture.contentOwnsPan(at: text, within: container))
        text.selectedRange = NSRange(location: 0, length: 5)
        XCTAssertTrue(PhonePopGesture.contentOwnsPan(at: text, within: container))
    }
}
