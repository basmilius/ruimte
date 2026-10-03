import SwiftUI
import UIKit
import XCTest

@testable import Ruimte

final class PhonePopGestureTests: XCTestCase {
    func testOnlyAPanTowardTheTrailingEdgeGoesBack() {
        XCTAssertTrue(PhonePopGesture.pansBack(translation: CGPoint(x: 12, y: 3), velocity: .zero, rightToLeft: false))
        XCTAssertFalse(
            PhonePopGesture.pansBack(translation: CGPoint(x: -12, y: 3), velocity: .zero, rightToLeft: false))
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
        XCTAssertNil(PhonePopGesture.contentPanOwner(at: row, within: container))
    }

    @MainActor func testContentThatPansSidewaysKeepsTheSwipe() {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 800))
        let code = UIScrollView(frame: container.bounds)
        code.contentSize = CGSize(width: 1200, height: 800)
        container.addSubview(code)
        XCTAssertIdentical(PhonePopGesture.contentPanOwner(at: code, within: container), code)

        let canvas = UIScrollView(frame: container.bounds)
        canvas.minimumZoomScale = 0.1
        canvas.maximumZoomScale = 8
        let node = UIView(frame: CGRect(x: 20, y: 20, width: 100, height: 100))
        canvas.addSubview(node)
        container.addSubview(canvas)
        XCTAssertIdentical(PhonePopGesture.contentPanOwner(at: node, within: container), canvas)

        let selecting = UIView(frame: container.bounds)
        selecting.addGestureRecognizer(UIPanGestureRecognizer())
        container.addSubview(selecting)
        XCTAssertIdentical(PhonePopGesture.contentPanOwner(at: selecting, within: container), selecting)
    }

    @MainActor func testSelectedTextKeepsTheSwipeForItsHandles() {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 800))
        let text = UITextView(frame: CGRect(x: 0, y: 700, width: 390, height: 44))
        text.isScrollEnabled = false
        text.text = "Hello there"
        container.addSubview(text)
        text.selectedRange = NSRange(location: 0, length: 0)
        XCTAssertNil(PhonePopGesture.contentPanOwner(at: text, within: container))
        text.selectedRange = NSRange(location: 0, length: 5)
        XCTAssertNotNil(PhonePopGesture.contentPanOwner(at: text, within: container))
    }

    @MainActor func testTheEdgeGoesBackOverContentThatPansSideways() {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 800))
        let code = UIScrollView(frame: container.bounds)
        code.contentSize = CGSize(width: 1200, height: 800)
        container.addSubview(code)
        let back = (translation: CGPoint(x: 40, y: 2), velocity: CGPoint(x: 400, y: 0))

        XCTAssertEqual(
            PhonePopGesture.refusal(
                canPop: true, motion: back, start: CGPoint(x: 200, y: 300), in: container,
                edgeWidth: PhoneSwipeBack.edgeWidth),
            .contentPans("UIScrollView"))
        XCTAssertNil(
            PhonePopGesture.refusal(
                canPop: true, motion: back, start: CGPoint(x: 8, y: 300), in: container,
                edgeWidth: PhoneSwipeBack.edgeWidth))
        XCTAssertEqual(
            PhonePopGesture.refusal(
                canPop: true, motion: (CGPoint(x: -40, y: 2), CGPoint(x: -400, y: 0)), start: CGPoint(x: 8, y: 300),
                in: container, edgeWidth: PhoneSwipeBack.edgeWidth),
            .notTowardTrailingEdge)
        XCTAssertEqual(
            PhonePopGesture.refusal(
                canPop: false, motion: back, start: CGPoint(x: 8, y: 300), in: container,
                edgeWidth: PhoneSwipeBack.edgeWidth),
            .nothingToPop)
    }

    @MainActor func testARowsSwipeActionsGoFirstAwayFromTheEdge() {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 800))
        let list = UICollectionView(frame: container.bounds, collectionViewLayout: UICollectionViewFlowLayout())
        let rowSwipe = FakeSwipeActionPanGestureRecognizer()
        list.addGestureRecognizer(rowSwipe)
        container.addSubview(list)

        XCTAssertTrue(PhonePopGesture.isRowSwipe(rowSwipe))
        XCTAssertFalse(PhonePopGesture.isRowSwipe(list.panGestureRecognizer))
        XCTAssertTrue(
            PhonePopGesture.yieldsToRowSwipe(rowSwipe, start: CGPoint(x: 200, y: 100), in: container, edgeWidth: 0))
        XCTAssertTrue(
            PhonePopGesture.yieldsToRowSwipe(
                rowSwipe, start: CGPoint(x: 200, y: 100), in: container, edgeWidth: PhoneSwipeBack.edgeWidth))
        XCTAssertFalse(
            PhonePopGesture.yieldsToRowSwipe(
                rowSwipe, start: CGPoint(x: 8, y: 100), in: container, edgeWidth: PhoneSwipeBack.edgeWidth))

        let elsewhere = UIView()
        let otherRowSwipe = FakeSwipeActionPanGestureRecognizer()
        elsewhere.addGestureRecognizer(otherRowSwipe)
        XCTAssertFalse(
            PhonePopGesture.yieldsToRowSwipe(otherRowSwipe, start: CGPoint(x: 200, y: 100), in: container, edgeWidth: 0)
        )
    }

    /// UIKit's own swipes on the stack around the tabs, with its hidden bar, let a view go back with no swipe at all,
    /// not even from the edge.
    @MainActor func testAViewOverTheTabsGoesBackThroughItsOwnSwipe() throws {
        let root = PhoneRootController(tabs: PhoneTabController(roots: [:]))
        let view = PhoneViewController(page: PhonePageController(route: nil, page: AnyView(EmptyView())))
        root.setViewControllers([root.tabs, view], animated: false)
        root.loadViewIfNeeded()

        XCTAssertTrue(root.canSwipeBack)
        XCTAssertEqual(root.interactivePopGestureRecognizer?.isEnabled, false)
        XCTAssertEqual(root.interactiveContentPopGestureRecognizer?.isEnabled, false)
        let swipeBack = try XCTUnwrap(root.swipeBack)
        XCTAssertTrue(root.view.gestureRecognizers?.contains { $0 === swipeBack.recognizer } ?? false)
        XCTAssertNil(swipeBack.animator(for: .pop), "Only a pop the swipe drives leaves UIKit's own animation")
    }
}

/// Named like UIKit's pan behind a list row's swipe actions.
private final class FakeSwipeActionPanGestureRecognizer: UIPanGestureRecognizer {}
