import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct ChatTimeline: UIViewControllerRepresentable {
    let presentation: ChatPresentation
    let client: any MachineRequesting
    let chatID: String
    var topInset: CGFloat = 0
    var bottomInset: CGFloat = 0
    var dismissKeyboard: () -> Void = {}
    var scrollToLatest = 0
    var onMessagesBelowChanged: (Bool) -> Void = { _ in }

    func makeUIViewController(context: Context) -> ChatTimelineController {
        ChatTimelineController(client: client, chatID: chatID, presentation: presentation)
    }
    func updateUIViewController(_ controller: ChatTimelineController, context: Context) {
        controller.bind(presentation)
        controller.dismissKeyboard = dismissKeyboard
        controller.onMessagesBelowChanged = onMessagesBelowChanged
        controller.setViewportInsets(top: topInset, bottom: bottomInset)
        controller.update(entries: presentation.entries, revision: presentation.revision)
        controller.scrollToLatest(command: scrollToLatest)
        controller.scrollToItem(presentation.requestedItemID, command: presentation.scrollRequest)
    }
}

struct ChatViewportGeometry: Equatable {
    let contentHeight: CGFloat
    let height: CGFloat
    var topInset: CGFloat = 0
    var bottomInset: CGFloat = 0

    var bottom: CGFloat { max(-topInset, contentHeight - height + bottomInset) }
    func clamped(_ offset: CGFloat) -> CGFloat { min(bottom, max(-topInset, offset)) }
    func isNearBottom(_ offset: CGFloat) -> Bool { bottom - offset <= 80 }

    func revealing(_ frame: CGRect, from offset: CGFloat) -> CGFloat {
        let available = max(0, height - topInset - bottomInset - 16)
        let top = offset + topInset + 8
        let bottom = offset + height - bottomInset - 8
        if frame.height > available || frame.minY < top {
            return clamped(frame.minY - topInset - 8)
        }
        if frame.maxY > bottom { return clamped(frame.maxY - height + bottomInset + 8) }
        return clamped(offset)
    }
}

struct ChatViewportState {
    private(set) var followsLatest = true
    private(set) var isInteracting = false
    private(set) var interactionRevision = 0

    mutating func beginInteraction() {
        interactionRevision += 1
        isInteracting = true
        followsLatest = false
    }

    mutating func finishInteraction(geometry: ChatViewportGeometry, offset: CGFloat) {
        isInteracting = false
        followsLatest = geometry.isNearBottom(offset)
    }

    mutating func readHere() {
        isInteracting = false
        interactionRevision += 1
        followsLatest = false
    }

    mutating func followLatest() {
        interactionRevision += 1
        isInteracting = false
        followsLatest = true
    }

    func offset(geometry: ChatViewportGeometry, readingAnchor: CGFloat?) -> CGFloat? {
        guard !isInteracting else { return nil }
        if followsLatest { return geometry.bottom }
        return readingAnchor.map(geometry.clamped)
    }
}

struct ChatReadingAnchor {
    let id: String
    let distanceFromTop: CGFloat

    func offset(itemTop: CGFloat, inset: CGFloat) -> CGFloat { itemTop - distanceFromTop - inset }
}

struct ChatExpansionAnchor {
    let id: String
    let followingID: String?
    let throughEnd: Bool
    let headerOffset: CGFloat
    let initialHeight: CGFloat
    let animated: Bool
}

@MainActor
final class ChatTimelineCollection: UICollectionView {
    override init(frame: CGRect, collectionViewLayout layout: UICollectionViewLayout) {
        super.init(frame: frame, collectionViewLayout: layout)
        // Streaming and disclosures resize the hosted view without reconfiguring its collection cell.
        selfSizingInvalidation = .enabledIncludingConstraints
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    private(set) var viewport = ChatViewportState()
    var captureReadingAnchor: (() -> ChatReadingAnchor?)?
    var itemTop: ((String) -> CGFloat?)?
    var itemFrame: ((String) -> CGRect?)?
    private var expansion: ChatExpansionAnchor?
    var viewportChanged: (() -> Void)?
    private var readingAnchor: ChatReadingAnchor?
    private var adjustingOffset = false
    private var scrollingToTarget = false
    private var measuredGeometry: ChatViewportGeometry?
    private var contentChangePending = true

    var geometry: ChatViewportGeometry {
        ChatViewportGeometry(
            contentHeight: contentSize.height, height: bounds.height,
            topInset: adjustedContentInset.top, bottomInset: adjustedContentInset.bottom)
    }
    var userIsScrolling: Bool { isTracking || isDragging || isDecelerating || viewport.isInteracting }

    func prepareForContentChange() {
        contentChangePending = true
        if !viewport.followsLatest && !userIsScrolling { readingAnchor = captureReadingAnchor?() }
    }

    func beginUserScroll() {
        expansion = nil
        scrollingToTarget = false
        viewport.beginInteraction()
        readingAnchor = nil
    }

    func finishUserScroll() {
        guard viewport.isInteracting else { return }
        viewport.finishInteraction(geometry: geometry, offset: contentOffset.y)
        readingAnchor = viewport.followsLatest ? nil : captureReadingAnchor?()
        setNeedsLayout()
    }

    func changeDisclosure(
        id: String, followingID: String? = nil, throughEnd: Bool = false, expanding: Bool, headerOffset: CGFloat,
        animated: Bool
    ) {
        cancelProgrammaticScroll()
        viewport.readHere()
        contentChangePending = true
        readingAnchor = captureReadingAnchor?()
        expansion = nil
        guard expanding, let frame = itemFrame?(id) else { return }
        let end = followingID.flatMap { itemTop?($0) } ?? (throughEnd ? contentSize.height : frame.maxY)
        expansion = ChatExpansionAnchor(
            id: id, followingID: followingID, throughEnd: throughEnd, headerOffset: headerOffset,
            initialHeight: end - frame.minY,
            animated: animated)
    }

    private func cancelProgrammaticScroll() {
        scrollingToTarget = false
        stopScrollingAndZooming()
    }

    func scrollToLatest(animated: Bool) {
        cancelProgrammaticScroll()
        expansion = nil
        readingAnchor = nil
        // Suppress anchor restoration while pending self-sizing catches up to the explicit scroll command.
        scrollingToTarget = true
        layoutIfNeeded()
        viewport.followLatest()
        scroll(to: geometry.bottom, animated: animated)
    }

    private func scroll(to offset: CGFloat, animated: Bool) {
        scrollingToTarget = animated && abs(contentOffset.y - offset) >= 1
        setContentOffset(CGPoint(x: contentOffset.x, y: offset), animated: scrollingToTarget)
        if !scrollingToTarget && !viewport.followsLatest { readingAnchor = captureReadingAnchor?() }
        setNeedsLayout()
    }

    func finishProgrammaticScroll() {
        guard scrollingToTarget else { return }
        scrollingToTarget = false
        if !viewport.followsLatest { readingAnchor = captureReadingAnchor?() }
        contentChangePending = true
        setNeedsLayout()
    }

    private func revealExpansion() -> Bool {
        guard let expansion else { return false }
        guard let frame = itemFrame?(expansion.id) else {
            self.expansion = nil
            return false
        }
        let end =
            expansion.followingID.flatMap { itemTop?($0) } ?? (expansion.throughEnd ? contentSize.height : frame.maxY)
        guard end - frame.minY > expansion.initialHeight + 1 else { return false }
        self.expansion = nil
        let top = frame.minY + expansion.headerOffset
        let target = CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, end - top))
        scroll(to: geometry.revealing(target, from: contentOffset.y), animated: expansion.animated)
        return true
    }

    func targetOffset(_ proposed: CGPoint) -> CGPoint {
        guard !userIsScrolling, !scrollingToTarget, !viewport.followsLatest,
            let anchor = readingAnchor, let top = itemTop?(anchor.id)
        else { return proposed }
        return CGPoint(x: proposed.x, y: geometry.clamped(anchor.offset(itemTop: top, inset: adjustedContentInset.top)))
    }

    override func layoutSubviews() {
        if userIsScrolling || scrollingToTarget {
            super.layoutSubviews()
        } else {
            UIView.performWithoutAnimation { super.layoutSubviews() }
        }
        defer { viewportChanged?() }
        let currentGeometry = geometry
        let needsRestoration = contentChangePending || measuredGeometry != currentGeometry
        measuredGeometry = currentGeometry
        contentChangePending = false
        if !adjustingOffset, !userIsScrolling, !scrollingToTarget, revealExpansion() { return }
        guard needsRestoration else { return }
        guard !adjustingOffset, !userIsScrolling, !scrollingToTarget, bounds.height > 0 else { return }
        let anchorOffset = readingAnchor.flatMap { anchor in
            itemTop?(anchor.id).map { anchor.offset(itemTop: $0, inset: adjustedContentInset.top) }
        }
        if let offset = viewport.offset(geometry: geometry, readingAnchor: anchorOffset),
            abs(contentOffset.y - offset) >= 1
        {
            adjustingOffset = true
            setContentOffset(CGPoint(x: contentOffset.x, y: offset), animated: false)
            adjustingOffset = false
        }
        // Hosted text can finish measuring after a snapshot. Keep the same reading position on those later passes too.
        if !viewport.followsLatest { readingAnchor = captureReadingAnchor?() }
    }
}

@MainActor
final class ChatTimelineController: UIViewController, UICollectionViewDelegate, UIGestureRecognizerDelegate {
    var dismissKeyboard: () -> Void = {}
    var onMessagesBelowChanged: (Bool) -> Void = { _ in }
    private var lastScrollCommand = 0
    private var lastItemScrollCommand = 0
    private var requestedItem: String?
    private var messagesBelow = false
    private let client: any MachineRequesting
    private let chatID: String
    private var presentation: ChatPresentation
    init(client: any MachineRequesting, chatID: String, presentation: ChatPresentation) {
        self.presentation = presentation
        self.lastItemScrollCommand = presentation.scrollRequest
        self.client = client
        self.chatID = chatID
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    private var collection: ChatTimelineCollection!
    private var source: UICollectionViewDiffableDataSource<Int, String>!
    private var items: [String: ChatTimelineEntry] = [:]
    private var lastRevision = -1
    private var pendingUpdate: ([ChatTimelineEntry], Int)?
    private var displayLink: CADisplayLink?
    private var applyingSnapshot = false

    override func viewDidLoad() {
        super.viewDidLoad()
        var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
        configuration.showsSeparators = false
        configuration.backgroundColor = MobileStyle.surfaceColor
        let layout = UICollectionViewCompositionalLayout { _, environment in
            NSCollectionLayoutSection.list(using: configuration, layoutEnvironment: environment)
        }
        layout.configuration.contentInsetsReference = .none
        collection = ChatTimelineCollection(frame: .zero, collectionViewLayout: layout)
        collection.keyboardDismissMode = .interactive
        collection.contentInsetAdjustmentBehavior = .never
        collection.alwaysBounceVertical = true
        collection.translatesAutoresizingMaskIntoConstraints = false
        collection.accessibilityIdentifier = "chat.timeline"
        collection.delegate = self
        collection.viewportChanged = { [weak self] in self?.reportMessagesBelow() }
        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissComposerKeyboard))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        collection.addGestureRecognizer(tap)
        collection.captureReadingAnchor = { [weak self] in self?.visibleAnchor() }
        collection.itemFrame = { [weak self] id in
            guard let self, let index = self.source.indexPath(for: id) else { return nil }
            return self.collection.layoutAttributesForItem(at: index)?.frame
        }
        collection.itemTop = { [weak self] id in
            guard let self, let index = self.source.indexPath(for: id) else { return nil }
            return self.collection.layoutAttributesForItem(at: index)?.frame.minY
        }
        view.addSubview(collection)
        setContentScrollView(collection, for: .top)
        NSLayoutConstraint.activate([
            collection.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collection.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collection.topAnchor.constraint(equalTo: view.topAnchor),
            collection.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        let registration = UICollectionView.CellRegistration<ChatHostingCell, String> {
            [weak self] cell, _, id in
            guard let self, let item = self.items[id] else { return }
            cell.host(in: self) {
                ChatEntryView(entry: item, presentation: self.presentation, client: self.client, chatID: self.chatID)
                    .id(id)
                    .environment(
                        \.chatWillExpand,
                        { [weak self] expanding, headerOffset in
                            guard let self else { return }
                            let ids = self.source.snapshot().itemIdentifiers
                            let next = ids.firstIndex(of: id).flatMap { index in
                                ids.indices.contains(index + 1) ? ids[index + 1] : nil
                            }
                            self.collection.changeDisclosure(
                                id: id, followingID: item.kind == .turnFold ? next : nil,
                                throughEnd: item.kind == .turnFold && next == nil,
                                expanding: expanding, headerOffset: headerOffset,
                                animated: !UIAccessibility.isReduceMotionEnabled)
                        }
                    )
                    .disclosureGroupStyle(ChatDisclosureStyle())
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .fixedSize(horizontal: false, vertical: true)
                    // The collection owns toolbar and keyboard insets; individual messages must scroll through them.
                    .ignoresSafeArea()
                    .transaction { transaction in
                        transaction.animation = nil
                        transaction.disablesAnimations = true
                    }
                    .padding(.horizontal, 20).padding(.vertical, 10)
                    .coordinateSpace(name: "chat.row")
            }
            cell.backgroundConfiguration = .clear()
        }
        source = UICollectionViewDiffableDataSource<Int, String>(collectionView: collection) { collection, index, id in
            collection.dequeueConfiguredReusableCell(using: registration, for: index, item: id)
        }
    }

    func bind(_ presentation: ChatPresentation) {
        guard self.presentation !== presentation else { return }
        self.presentation = presentation
        lastItemScrollCommand = presentation.scrollRequest
        requestedItem = nil
        lastRevision = -1
        items = [:]
    }

    func setViewportInsets(top: CGFloat, bottom: CGFloat) {
        loadViewIfNeeded()
        let insets = UIEdgeInsets(top: max(0, top), left: 0, bottom: max(0, bottom), right: 0)
        guard collection.contentInset != insets else { return }
        collection.prepareForContentChange()
        collection.contentInset = insets
        collection.verticalScrollIndicatorInsets = insets
        collection.setNeedsLayout()
    }

    func scrollToLatest(command: Int) {
        guard command != lastScrollCommand else { return }
        lastScrollCommand = command
        loadViewIfNeeded()
        collection.scrollToLatest(animated: !UIAccessibility.isReduceMotionEnabled)
    }

    func scrollToItem(_ id: String?, command: Int) {
        guard command != lastItemScrollCommand else { return }
        lastItemScrollCommand = command
        requestedItem = id
        fulfillItemScroll()
    }

    private func fulfillItemScroll() {
        guard pendingUpdate == nil, !applyingSnapshot, let id = requestedItem,
            let index = source.indexPath(for: id)
        else { return }
        requestedItem = nil
        collection.beginUserScroll()
        collection.layoutIfNeeded()
        collection.scrollToItem(at: index, at: .top, animated: false)
        collection.finishUserScroll()
    }

    private func reportMessagesBelow() {
        let below = !collection.geometry.isNearBottom(collection.contentOffset.y)
        guard below != messagesBelow else { return }
        messagesBelow = below
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.onMessagesBelowChanged(self.messagesBelow)
        }
    }

    @objc private func dismissComposerKeyboard() {
        dismissKeyboard()
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool { true }

    func update(entries values: [ChatTimelineEntry], revision: Int) {
        guard revision != lastRevision else { return }
        loadViewIfNeeded()
        pendingUpdate = (values, revision)
        scheduleUpdate()
    }

    private func scheduleUpdate() {
        guard displayLink == nil, !applyingSnapshot, pendingUpdate != nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(flushUpdate))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func flushUpdate() {
        displayLink?.invalidate()
        displayLink = nil
        guard let (values, revision) = pendingUpdate, !applyingSnapshot else { return }
        // A prepend waits for the finger to lift so its reading anchor can be restored.
        if collection.userIsScrolling, let first = source.snapshot().itemIdentifiers.first,
            values.first?.id != first
        {
            return
        }
        pendingUpdate = nil
        collection.prepareForContentChange()
        let interactionRevision = collection.viewport.interactionRevision
        let previous = items
        let entries = values
        items = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        let ids = entries.map(\.id)
        let existingIDs = source.snapshot().itemIdentifiers
        var snapshot = source.snapshot()
        if snapshot.sectionIdentifiers.isEmpty { snapshot.appendSections([0]) }
        if ids.starts(with: existingIDs) {
            snapshot.appendItems(Array(ids.dropFirst(existingIDs.count)))
        } else {
            snapshot.deleteAllItems()
            snapshot.appendSections([0])
            snapshot.appendItems(ids)
        }
        let existing = Set(existingIDs)
        let changed = ids.filter { existing.contains($0) && previous[$0] != items[$0] }
        snapshot.reconfigureItems(changed)
        lastRevision = revision
        applyingSnapshot = true
        UIView.performWithoutAnimation {
            source.apply(snapshot, animatingDifferences: false) { [weak self] in
                guard let self else { return }
                self.applyingSnapshot = false
                if self.lastRevision == revision,
                    self.collection.viewport.interactionRevision == interactionRevision,
                    !self.collection.userIsScrolling
                {
                    self.collection.setNeedsLayout()
                    UIView.performWithoutAnimation { self.collection.layoutIfNeeded() }
                }
                self.fulfillItemScroll()
                self.scheduleUpdate()
            }
        }
    }

    private func visibleAnchor() -> ChatReadingAnchor? {
        let visibleTop = collection.contentOffset.y + collection.adjustedContentInset.top
        let visibleBottom =
            collection.contentOffset.y + collection.bounds.height - collection.adjustedContentInset.bottom
        for index in collection.indexPathsForVisibleItems.sorted() {
            guard let id = source.itemIdentifier(for: index),
                let frame = collection.layoutAttributesForItem(at: index)?.frame,
                frame.maxY > visibleTop, frame.minY < visibleBottom
            else { continue }
            return ChatReadingAnchor(id: id, distanceFromTop: frame.minY - visibleTop)
        }
        return nil
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) { collection.beginUserScroll() }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { reportMessagesBelow() }
    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) { collection.finishProgrammaticScroll() }
    func collectionView(
        _ collectionView: UICollectionView, targetContentOffsetForProposedContentOffset proposedContentOffset: CGPoint
    ) -> CGPoint {
        collection.targetOffset(proposedContentOffset)
    }
    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate {
            collection.finishUserScroll()
            scheduleUpdate()
        }
    }
    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        collection.finishUserScroll()
        scheduleUpdate()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        scheduleUpdate()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        displayLink?.invalidate()
        displayLink = nil
    }
}

@MainActor
final class ChatHostingCell: UICollectionViewListCell {
    private let hosting = UIHostingController(rootView: AnyView(EmptyView()))

    override init(frame: CGRect) {
        super.init(frame: frame)
        // Scroll cells own their insets. Window safe areas must never reposition a message inside its cell.
        hosting.safeAreaRegions = []
        hosting.sizingOptions = [.intrinsicContentSize]
        hosting.view.backgroundColor = .clear
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            hosting.view.topAnchor.constraint(equalTo: contentView.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    func host<Content: View>(in parent: UIViewController, @ViewBuilder content: () -> Content) {
        if hosting.parent !== parent {
            hosting.willMove(toParent: nil)
            hosting.removeFromParent()
            parent.addChild(hosting)
            hosting.didMove(toParent: parent)
        }
        hosting.rootView = AnyView(content())
        hosting.view.invalidateIntrinsicContentSize()
    }
}

extension EnvironmentValues {
    @Entry var chatWillExpand: (Bool, CGFloat) -> Void = { _, _ in }
}

struct ChatExpansionButton<Label: View>: View {
    let expanding: Bool
    let action: () -> Void
    @ViewBuilder var label: () -> Label
    @Environment(\.chatWillExpand) private var willExpand
    @State private var headerOffset: CGFloat = 0

    var body: some View {
        Button {
            willExpand(expanding, headerOffset)
            action()
        } label: {
            label()
                .onGeometryChange(for: CGFloat.self) {
                    $0.frame(in: .named("chat.row")).minY
                } action: {
                    headerOffset = $0
                }
        }
    }
}

private struct ChatDisclosureStyle: DisclosureGroupStyle {

    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ChatExpansionButton(expanding: !configuration.isExpanded) {
                configuration.isExpanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    configuration.label
                    Spacer(minLength: 0)
                    Image(lucide: configuration.isExpanded ? "chevron-down" : "chevron-right", size: 12)
                        .foregroundStyle(MobileStyle.muted)
                }
                .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(configuration.isExpanded ? "Expanded" : "Collapsed")
            if configuration.isExpanded { configuration.content }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

struct ChatEntryView: View {
    let entry: ChatTimelineEntry
    let presentation: ChatPresentation
    let client: any MachineRequesting
    let chatID: String
    @State private var expanded = false

    var body: some View {
        Group {
            switch entry.kind {
            case .activity: ChatWorkingRow(presentation: presentation)
            case .turnFold:
                if let turn = entry.items.first {
                    ChatExpansionButton(
                        expanding: !presentation.expandedTurns.contains(turn.value.text("turnId", fallback: turn.id))
                    ) {
                        presentation.toggleTurn(turn.value.text("turnId", fallback: turn.id))
                    } label: {
                        Label(
                            ChatPresentation.turnLabel(turn.value),
                            lucideIcon: presentation.expandedTurns.contains(
                                turn.value.text("turnId", fallback: turn.id)) ? "chevron-down" : "chevron-right",
                            iconSize: 12
                        )
                        .font(.footnote).foregroundStyle(
                            turn.value.text("state") == "error" ? Color.red : MobileStyle.muted
                        )
                        .padding(.horizontal, 10).frame(minHeight: 44)
                        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 8))
                        .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(MobileStyle.border) }
                    }.buttonStyle(.plain)
                        .accessibilityValue(
                            presentation.expandedTurns.contains(turn.value.text("turnId", fallback: turn.id))
                                ? "Expanded" : "Collapsed")
                }
            case .turnStart:
                if let turn = entry.items.first {
                    Button {
                        presentation.openSubagent(toolUseID: turn.value.text("taskToolUseId"))
                    } label: {
                        Label(
                            turn.value.text("label").isEmpty
                                ? "Continued on its own" : "Sub-agent finished: \(turn.value.text("label"))",
                            lucideIcon: "bot", iconSize: 14
                        )
                        .font(.footnote).foregroundStyle(MobileStyle.muted).frame(minHeight: 44)
                    }.buttonStyle(.plain).disabled(turn.value.text("taskToolUseId").isEmpty)
                }
            case .changedFiles:
                if let turn = entry.items.first {
                    ChatChangedFilesRow(
                        turn: turn, tools: Array(entry.items.dropFirst()), client: client, chatID: chatID)
                }
            case .subagent:
                if let agent = entry.items.first {
                    ChatSubagentRow(
                        agent: agent, children: Array(entry.items.dropFirst()), presentation: presentation,
                        client: client, chatID: chatID)
                }

            case .message:
                if let item = entry.items.first { ChatObservedRow(record: item, client: client, chatID: chatID) }
            case .tools:
                if entry.items.count == 1, let item = entry.items.first {
                    ChatObservedRow(record: item, client: client, chatID: chatID)
                } else {
                    DisclosureGroup(isExpanded: $expanded) {
                        ForEach(entry.items) { item in
                            ChatObservedRow(record: item, client: client, chatID: chatID)
                        }
                    } label: {
                        Label(
                            ChatToolPresentation.groupLabel(entry.items.map(\.value)), lucideIcon: "terminal",
                            iconSize: 14
                        )
                        .font(.footnote).foregroundStyle(MobileStyle.muted)
                    }
                }
            }
        }
        .modifier(
            ChatLinkRouting(
                context: ChatContentContext(client: client, chatID: chatID, cwd: presentation.info.text("cwd")))
        )
        .frame(maxWidth: 720, alignment: .leading)
        .frame(maxWidth: .infinity)
    }
}

struct ChatObservedRow: View {
    let record: ChatItemState
    let client: any MachineRequesting
    let chatID: String
    var body: some View {
        ChatTimelineRow(item: record.value, client: client, chatID: chatID)
            .modifier(ChatMessageMenu(text: record.value.text("text")))
    }
}

private struct ChatTimelineRow: View {
    let item: JSONValue
    let client: any MachineRequesting
    let chatID: String
    private var kind: String { item["kind"]?.stringValue ?? "" }
    var body: some View {
        content
            .frame(maxWidth: 720, alignment: kind == "user" ? .trailing : .leading)
            .frame(maxWidth: .infinity)
            .tint(MobileStyle.accent)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch kind {
            case "user":
                ChatUserMessage(item: item, client: client, chatID: chatID)
            case "assistant":
                ChatStreamingMessage(text: item.text("text"), streaming: item["streaming"]?.boolValue == true)
                    .accessibilityElement(children: .contain).accessibilityLabel("Agent")
            case "thinking":
                ChatThinkingRow(item: item)
            case "tool":
                ChatToolRow(item: item)
            case "subagent":
                DisclosureGroup(item["description"]?.stringValue ?? "Agent") {
                    Text(item["status"]?.stringValue ?? "").font(.caption)
                    MarkdownMessage(
                        text: item["result"]?.stringValue ?? item["summary"]?.stringValue ?? item["prompt"]?.stringValue
                            ?? "")
                }
            case "approval":
                let decision = item.text("decision")
                Label(
                    [
                        "allow": "Allowed", "allow-always": "Always allowed", "deny": "Declined",
                        "cancelled": "No longer needed",
                    ][decision, default: decision] + " · " + item.text("toolName"),
                    lucideIcon: decision == "deny" ? "circle-x" : "circle-check", iconSize: 14
                )
                .font(.caption).foregroundStyle(decision == "deny" ? Color.red : MobileStyle.muted)
            case "question":
                ForEach(Array(item.list("questions").enumerated()), id: \.offset) { _, question in
                    Label(question.text("question"), lucideIcon: "message-circle-question-mark", iconSize: 14).font(
                        .subheadline)
                    if let answer = item["answers"]?[question.text("id")]?.stringValue {
                        Text(answer).font(.subheadline)
                    } else {
                        Text(item.text("state") == "dismissed" ? "Dismissed" : "Not answered").font(.caption)
                            .foregroundStyle(MobileStyle.muted)
                    }
                }
            case "note":
                let level = item.text("level")
                Label(
                    item.text("text"),
                    lucideIcon: level == "error" ? "circle-alert" : level == "warning" ? "triangle-alert" : "info",
                    iconSize: 14
                )
                .font(.callout).foregroundStyle(
                    level == "error" ? Color.red : level == "warning" ? Color.orange : MobileStyle.muted
                )
                .accessibilityLabel("\(level.capitalized): \(item.text("text"))")
            case "turn":
                Label(
                    item["label"]?.stringValue ?? "Turn \(item["state"]?.stringValue ?? "")",
                    lucideIcon: "circle-dashed", iconSize: 14
                ).font(.caption).foregroundStyle(MobileStyle.muted)
                if let files = item["checkpointDiff"]?["files"]?.arrayValue, !files.isEmpty {
                    DisclosureGroup("\(files.count) changed files") {
                        ForEach(Array(files.enumerated()), id: \.offset) { _, file in
                            Text(file["path"]?.stringValue ?? "").font(.caption.bold())
                            CodeMessage(text: file["diff"]?.stringValue ?? file["omitted"]?.stringValue ?? "")
                        }
                    }
                }
            case "compaction":
                Label(
                    item["preTokens"]?.numberValue.map { "Context compacted from \(Int($0).formatted()) tokens" }
                        ?? "Context compacted", lucideIcon: "minimize-2", iconSize: 14
                ).font(.caption)
                    .foregroundStyle(MobileStyle.muted)
            default: MarkdownMessage(text: item["text"]?.stringValue ?? "")
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
