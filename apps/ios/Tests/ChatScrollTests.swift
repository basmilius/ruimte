import UIKit
import XCTest

@testable import Ruimte

final class ChatScrollTests: XCTestCase {
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
