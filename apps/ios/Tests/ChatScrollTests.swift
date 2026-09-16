import SwiftUI
import UIKit
import XCTest

@testable import Ruimte

final class ChatScrollTests: XCTestCase {
    func testExpansionRevealsOnlyWhatIsOutsideTheReadableViewport() {
        let geometry = ChatViewportGeometry(contentHeight: 2000, height: 600, topInset: 80, bottomInset: 120)
        func offset(_ top: CGFloat, _ height: CGFloat) -> CGFloat {
            geometry.revealing(CGRect(x: 0, y: top, width: 320, height: height), from: 400)
        }
        XCTAssertEqual(offset(500, 200), 400)
        XCTAssertEqual(offset(800, 200), 528)
        XCTAssertEqual(offset(800, 900), 712)
        XCTAssertEqual(offset(350, 100), 262)
        XCTAssertEqual(offset(0, 900), -80)
    }

    @MainActor func testExpansionWaitsForMeasurementAndKeepsTheClickedHeaderVisible() {
        let fixture = ChatLayoutFixture()
        let list = fixture.list
        list.beginUserScroll()
        list.contentOffset.y = 400
        list.finishUserScroll()
        list.changeDisclosure(id: "message-6", expanding: true, headerOffset: 12, animated: false)
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 400, accuracy: 1)
        fixture.layout.heights[6] = 220
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 528, accuracy: 1)
        XCTAssertFalse(list.viewport.followsLatest)

        list.changeDisclosure(id: "message-6", expanding: true, headerOffset: 100, animated: false)
        fixture.layout.heights[6] = 600
        fixture.relayout()
        XCTAssertEqual(
            list.contentOffset.y, 692, accuracy: 1, "Reveal the nested header, not the start of its outer row")
        fixture.layout.heights[11] = 400
        fixture.relayout()
        XCTAssertEqual(
            list.contentOffset.y, 692, accuracy: 1, "Later streaming must leave the expanded content in place")
    }

    @MainActor func testTurnExpansionRevealsInsertedRowsAndDraggingCancelsPendingReveal() {
        let fixture = ChatLayoutFixture()
        let list = fixture.list
        list.beginUserScroll()
        list.contentOffset.y = 400
        list.finishUserScroll()
        list.changeDisclosure(
            id: "message-6", followingID: "message-7", expanding: true, headerOffset: 0, animated: false)
        fixture.ids.insert("expanded-work", at: 7)
        fixture.layout.heights.insert(400, at: 7)
        list.reloadData()
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 592, accuracy: 1)

        list.changeDisclosure(id: "message-6", expanding: true, headerOffset: 0, animated: false)
        list.beginUserScroll()
        list.contentOffset.y = 300
        fixture.layout.heights[6] = 600
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 300, accuracy: 1)
    }

    @MainActor func testScrollToLatestTakesOverInteractionAndIgnoresItsLateCompletion() {
        let fixture = ChatLayoutFixture()
        let list = fixture.list
        list.beginUserScroll()
        list.contentOffset.y = 200
        list.scrollToLatest(animated: false)
        XCTAssertFalse(list.viewport.isInteracting)
        XCTAssertTrue(list.viewport.followsLatest)
        XCTAssertEqual(list.contentOffset.y, 900, accuracy: 1)
        fixture.layout.heights[11] = 300
        list.finishUserScroll()
        fixture.relayout()
        XCTAssertTrue(list.viewport.followsLatest)
        XCTAssertEqual(list.contentOffset.y, 1100, accuracy: 1)
    }

    @MainActor func testLastTurnExpansionRevealsWorkAppendedAfterItsHeader() {
        let fixture = ChatLayoutFixture()
        let list = fixture.list
        list.changeDisclosure(id: "message-11", throughEnd: true, expanding: true, headerOffset: 0, animated: false)
        fixture.ids.append("expanded-work")
        fixture.layout.heights.append(500)
        list.reloadData()
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 1092, accuracy: 1)
        XCTAssertFalse(list.viewport.followsLatest)
    }

    @MainActor func testScrollToLatestCancelsAnActiveNativeScrollAnimation() async {
        let fixture = ChatHostingFixture()
        defer { fixture.close() }
        fixture.state.height = 1200
        await fixture.renderFrames()
        let list = fixture.list
        list.beginUserScroll()
        list.setContentOffset(.zero, animated: false)
        list.finishUserScroll()
        list.setContentOffset(CGPoint(x: 0, y: 400), animated: true)
        await fixture.renderFrames()
        XCTAssertTrue(list.isScrollAnimating)
        list.scrollToLatest(animated: false)
        XCTAssertFalse(list.isScrollAnimating)
        await fixture.renderFrames()
        XCTAssertEqual(list.contentOffset.y, list.geometry.bottom, accuracy: 1)
        XCTAssertTrue(list.viewport.followsLatest)
    }

    @MainActor func testHostedRowsResizeWithoutReconfigurationWhenContentGrowsAndCollapses() async throws {
        let fixture = ChatHostingFixture()
        defer { fixture.close() }
        for height in [80.0, 240, 60, 180] {
            fixture.state.height = height
            await fixture.renderFrames()
            let first = try XCTUnwrap(fixture.list.layoutAttributesForItem(at: IndexPath(item: 0, section: 0)))
            let next = try XCTUnwrap(fixture.list.layoutAttributesForItem(at: IndexPath(item: 1, section: 0)))
            XCTAssertEqual(first.frame.height, height, accuracy: 1)
            XCTAssertEqual(next.frame.minY, first.frame.maxY, accuracy: 1)
        }
        XCTAssertEqual(fixture.configurations, 2, "Content changes must resize existing cells without rebuilding them")
    }

    func testLatestFollowsDelayedMeasurementAndKeyboardInsets() {
        let state = ChatViewportState()
        XCTAssertEqual(state.offset(geometry: .init(contentHeight: 1000, height: 600), readingAnchor: nil), 400)
        XCTAssertEqual(state.offset(geometry: .init(contentHeight: 1120, height: 600), readingAnchor: nil), 520)
        XCTAssertEqual(
            state.offset(geometry: .init(contentHeight: 1120, height: 350, bottomInset: 20), readingAnchor: nil), 790)
        XCTAssertEqual(state.offset(geometry: .init(contentHeight: 1120, height: 600), readingAnchor: nil), 520)
    }

    func testNewMessagesCannotTakeOverAnActiveDragOrResumeFollowingForAReader() {
        var state = ChatViewportState()
        state.beginInteraction()
        let revision = state.interactionRevision
        XCTAssertNil(state.offset(geometry: .init(contentHeight: 1300, height: 500), readingAnchor: 250))
        state.finishInteraction(geometry: .init(contentHeight: 1300, height: 500), offset: 250)
        XCTAssertFalse(state.followsLatest)
        XCTAssertEqual(state.offset(geometry: .init(contentHeight: 1600, height: 500), readingAnchor: 250), 250)
        state.beginInteraction()
        XCTAssertGreaterThan(state.interactionRevision, revision)
        state.finishInteraction(geometry: .init(contentHeight: 1600, height: 500), offset: 1080)
        XCTAssertTrue(state.followsLatest)
        XCTAssertEqual(state.offset(geometry: .init(contentHeight: 1680, height: 500), readingAnchor: 250), 1180)
    }

    func testPrependingAndChangingTopInsetPreserveTheSameMessageAtTheSameVisiblePosition() {
        var state = ChatViewportState()
        state.readHere()
        let anchor = ChatReadingAnchor(id: "message", distanceFromTop: -35)
        let before = anchor.offset(itemTop: 600, inset: 20)
        XCTAssertEqual(before, 615)
        let after = anchor.offset(itemTop: 840, inset: 40)
        XCTAssertEqual(
            state.offset(geometry: .init(contentHeight: 2000, height: 600, topInset: 40), readingAnchor: after), 835)
        XCTAssertEqual(840 - 835 - 40, -35)
    }

    func testExpansionStopsFollowingAndShortContentStaysWithinItsInsets() {
        var state = ChatViewportState()
        state.readHere()
        XCTAssertFalse(state.followsLatest)
        XCTAssertEqual(state.offset(geometry: .init(contentHeight: 1600, height: 500), readingAnchor: 410), 410)
        XCTAssertEqual(
            state.offset(geometry: .init(contentHeight: 80, height: 500, topInset: 24), readingAnchor: 410), -24)
    }

    @MainActor func testCollectionKeepsLatestThroughLaterCellMeasurementsAndViewportChanges() {
        let fixture = ChatLayoutFixture()
        let list = fixture.list
        XCTAssertEqual(list.contentOffset.y, 900, accuracy: 1)
        fixture.layout.heights[11] = 280
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 1080, accuracy: 1)
        list.frame.size.height = 200
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 1180, accuracy: 1)
        list.frame.size.height = 300
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 1080, accuracy: 1)
    }

    @MainActor func testNativeOffsetChangesAreNotPinnedWhenContentAndViewportHaveNotChanged() {
        let fixture = ChatLayoutFixture()
        fixture.list.contentInset.top = 80
        fixture.list.contentInset.bottom = 120
        fixture.relayout()
        for offset in [700.0, 420, 180, -40] {
            fixture.list.setContentOffset(CGPoint(x: 0, y: offset), animated: false)
            fixture.relayout()
            XCTAssertEqual(fixture.list.contentOffset.y, offset, accuracy: 1)
        }
    }

    @MainActor func testCollectionPreservesReaderAcrossPrependAndFurtherDelayedHeightChanges() {
        let fixture = ChatLayoutFixture()
        let list = fixture.list
        list.beginUserScroll()
        list.contentOffset.y = 615
        list.finishUserScroll()
        XCTAssertFalse(list.viewport.followsLatest)
        list.prepareForContentChange()
        fixture.ids.insert("older", at: 0)
        fixture.layout.heights.insert(140, at: 0)
        list.reloadData()
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 755, accuracy: 1)
        fixture.layout.heights[0] = 200
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 815, accuracy: 1)
        XCTAssertFalse(list.viewport.followsLatest)
    }

    @MainActor func testCollectionDoesNotScrollStreamingOutputDuringDragOrDeceleration() {
        let fixture = ChatLayoutFixture()
        let list = fixture.list
        list.beginUserScroll()
        list.contentOffset.y = 420
        fixture.layout.heights[11] = 300
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 420, accuracy: 1)
        fixture.layout.heights[11] = 450
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 420, accuracy: 1)
        list.finishUserScroll()
        fixture.layout.heights[11] = 600
        fixture.relayout()
        XCTAssertEqual(list.contentOffset.y, 420, accuracy: 1)
    }
}

@MainActor @Observable
private final class ChatHostingState {
    var height: CGFloat = 80
}

private struct ChatResizingContent: View {
    let state: ChatHostingState
    var body: some View {
        Text("Growing chat content")
            .frame(maxWidth: .infinity)
            .frame(height: state.height)
            .fixedSize(horizontal: false, vertical: true)
            .ignoresSafeArea()
    }
}

@MainActor
private final class ChatHostingFixture: NSObject, UICollectionViewDataSource {
    let state = ChatHostingState()
    let parent = UIViewController()
    let window: UIWindow
    let list: ChatTimelineCollection
    private(set) var configurations = 0

    override init() {
        var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
        configuration.showsSeparators = false
        let layout = UICollectionViewCompositionalLayout.list(using: configuration)
        list = ChatTimelineCollection(frame: CGRect(x: 0, y: 0, width: 320, height: 600), collectionViewLayout: layout)
        if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
            window = UIWindow(windowScene: scene)
        } else {
            window = UIWindow(frame: list.frame)
        }
        super.init()
        list.contentInsetAdjustmentBehavior = .never
        list.register(ChatHostingCell.self, forCellWithReuseIdentifier: "hosted")
        list.dataSource = self
        parent.view.addSubview(list)
        window.rootViewController = parent
        window.makeKeyAndVisible()
        list.reloadData()
    }

    func close() {
        window.isHidden = true
        window.rootViewController = nil
    }

    func renderFrames() async {
        for _ in 0..<8 {
            await withCheckedContinuation { continuation in
                _ = ChatLayoutFrame { continuation.resume() }
            }
        }
    }

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { 2 }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell
    {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "hosted", for: indexPath) as! ChatHostingCell
        configurations += 1
        cell.host(in: parent) {
            if indexPath.item == 0 {
                ChatResizingContent(state: state)
            } else {
                Text("Following message").frame(height: 44)
            }
        }
        return cell
    }
}

@MainActor
private final class ChatLayoutFrame: NSObject {
    private var link: CADisplayLink?
    private var completion: (() -> Void)?

    init(completion: @escaping () -> Void) {
        self.completion = completion
        super.init()
        let link = CADisplayLink(target: self, selector: #selector(frame))
        self.link = link
        link.add(to: .main, forMode: .common)
    }

    @objc private func frame() {
        link?.invalidate()
        link = nil
        completion?()
        completion = nil
    }
}

@MainActor
private final class ChatLayoutFixture: NSObject, UICollectionViewDataSource {
    var ids = (0..<12).map { "message-\($0)" }
    let layout: ChatMeasuredLayout
    let list: ChatTimelineCollection

    override init() {
        let layout = ChatMeasuredLayout()
        self.layout = layout
        list = ChatTimelineCollection(frame: CGRect(x: 0, y: 0, width: 320, height: 300), collectionViewLayout: layout)
        super.init()
        list.contentInsetAdjustmentBehavior = .never
        list.register(UICollectionViewCell.self, forCellWithReuseIdentifier: "message")
        list.dataSource = self
        list.captureReadingAnchor = { [weak self] in
            guard let self else { return nil }
            let top = self.list.contentOffset.y + self.list.adjustedContentInset.top
            for index in self.list.indexPathsForVisibleItems.sorted() {
                guard self.ids.indices.contains(index.item),
                    let attributes = self.layout.layoutAttributesForItem(at: index), attributes.frame.maxY > top
                else { continue }
                return ChatReadingAnchor(id: self.ids[index.item], distanceFromTop: attributes.frame.minY - top)
            }
            return nil
        }
        list.itemTop = { [weak self] id in
            guard let self, let index = self.ids.firstIndex(of: id) else { return nil }
            return self.layout.layoutAttributesForItem(at: IndexPath(item: index, section: 0))?.frame.minY
        }
        list.itemFrame = { [weak self] id in
            guard let self, let index = self.ids.firstIndex(of: id) else { return nil }
            return self.layout.layoutAttributesForItem(at: IndexPath(item: index, section: 0))?.frame
        }
        list.reloadData()
        relayout()
    }

    func relayout() {
        layout.invalidateLayout()
        list.setNeedsLayout()
        list.layoutIfNeeded()
    }

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { ids.count }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell
    {
        collectionView.dequeueReusableCell(withReuseIdentifier: "message", for: indexPath)
    }
}

@MainActor
private final class ChatMeasuredLayout: UICollectionViewLayout {
    var heights: [CGFloat] = Array(repeating: 100, count: 12)

    override var collectionViewContentSize: CGSize { CGSize(width: 320, height: heights.reduce(0, +)) }
    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        guard heights.indices.contains(indexPath.item) else { return nil }
        let attributes = UICollectionViewLayoutAttributes(forCellWith: indexPath)
        attributes.frame = CGRect(
            x: 0, y: heights.prefix(indexPath.item).reduce(0, +), width: 320, height: heights[indexPath.item])
        return attributes
    }
    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        heights.indices.compactMap { layoutAttributesForItem(at: IndexPath(item: $0, section: 0)) }.filter {
            $0.frame.intersects(rect)
        }
    }
    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        newBounds.size != collectionView?.bounds.size
    }
}
