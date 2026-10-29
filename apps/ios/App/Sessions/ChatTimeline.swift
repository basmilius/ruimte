import RuimteIntelligentUI
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit
import os

// TODO(Bas): remove once the blank chat screen behind a menu or a sheet is explained.
/// What the chat's UIKit container goes through around a presentation. In Console.app: subsystem `app.ruimte.mobile`,
/// category `chat-presentation`; the layout lines are debug messages.
let chatPresentationLog = Logger(subsystem: "app.ruimte.mobile", category: "chat-presentation")

struct ChatTimeline: UIViewControllerRepresentable {
    static let rowInset: CGFloat = 20

    let presentation: ChatPresentation
    let client: any MachineRequesting
    let chatID: String
    var uiModels: ChatUiModels?
    var workspace: MobileWorkspace?
    var topInset: CGFloat = 0
    var bottomInset: CGFloat = 0
    var composer: AnyView?
    var composerFade: ChatComposerFadeLink?
    var latestButton: AnyView?
    var status: AnyView?
    var onViewportHeightChanged: (CGFloat) -> Void = { _ in }
    var dismissKeyboard: () -> Void = {}
    var scrollToLatest = 0
    var onMessagesBelowChanged: (Bool) -> Void = { _ in }
    /// Called on every pass that finds the reader near the top with nothing waiting to go in.
    var onNearTop: () -> Void = {}

    func makeUIViewController(context: Context) -> ChatTimelineController {
        chatPresentationLog.notice("timeline made for \(chatID, privacy: .public)")
        return ChatTimelineController(
            client: client, chatID: chatID, presentation: presentation, uiModels: uiModels, workspace: workspace)
    }

    static func dismantleUIViewController(_ controller: ChatTimelineController, coordinator: ()) {
        chatPresentationLog.notice("timeline dismantled")
    }

    func updateUIViewController(_ controller: ChatTimelineController, context: Context) {
        controller.bind(presentation)
        controller.dismissKeyboard = dismissKeyboard
        controller.onMessagesBelowChanged = onMessagesBelowChanged
        controller.onNearTop = onNearTop
        controller.onViewportHeightChanged = onViewportHeightChanged
        composerFade?.attach(controller)
        controller.setComposer(composer, latestButton: latestButton)
        controller.setStatus(status)
        context.animate {
            controller.setViewportInsets(top: topInset, bottom: bottomInset)
        }
        controller.update(entries: presentation.entries, revision: presentation.revision)
        controller.askForEarlierNearTop()
        controller.scrollToLatest(command: scrollToLatest)
        controller.scrollToItem(presentation.requestedItemID, command: presentation.scrollRequest)
    }
}

/// How far below the composer's top the timeline starts to fade, so it keeps showing behind what stands above the
/// field. It goes straight to the controller: as view state it re-rendered the screen from the composer's own layout
/// pass, and the app hung in that loop.
@MainActor final class ChatComposerFadeLink {
    private weak var controller: ChatTimelineController?
    private var start: CGFloat = 0

    func update(_ start: CGFloat) {
        guard abs(start - self.start) >= 0.5 else { return }
        self.start = start
        controller?.setComposerFadeStart(start)
    }

    fileprivate func attach(_ controller: ChatTimelineController) {
        guard self.controller !== controller else { return }
        self.controller = controller
        controller.setComposerFadeStart(start)
    }
}

struct ChatViewportGeometry: Equatable {
    let contentHeight: CGFloat
    let height: CGFloat
    var topInset: CGFloat = 0
    var bottomInset: CGFloat = 0

    var bottom: CGFloat { max(-topInset, contentHeight - height + bottomInset) }
    func clamped(_ offset: CGFloat) -> CGFloat { min(bottom, max(-topInset, offset)) }
    /// Within one and a half screens of the top, so the page before is there before the reader reaches the edge.
    func isNearTop(_ offset: CGFloat) -> Bool { offset + topInset < height * 1.5 }
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
        let end = expansionEnd(frame, followingID: followingID, throughEnd: throughEnd)
        expansion = ChatExpansionAnchor(
            id: id, followingID: followingID, throughEnd: throughEnd, headerOffset: headerOffset,
            initialHeight: end - frame.minY, animated: animated)
    }

    /// Where an opened row's content ends: at the row after it, at the end of the thread, or at its own end.
    private func expansionEnd(_ frame: CGRect, followingID: String?, throughEnd: Bool) -> CGFloat {
        followingID.flatMap { itemTop?($0) } ?? (throughEnd ? contentSize.height : frame.maxY)
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
        let end = expansionEnd(frame, followingID: expansion.followingID, throughEnd: expansion.throughEnd)
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
        let resizingViewport =
            measuredGeometry.map {
                $0.height != bounds.height || $0.topInset != adjustedContentInset.top
                    || $0.bottomInset != adjustedContentInset.bottom
            } ?? false
        let animatesViewport = resizingViewport && !UIAccessibility.isReduceMotionEnabled
        // Keyboard and composer resizing inherit their enclosing animation; streamed row sizing stays immediate.
        if userIsScrolling || scrollingToTarget || animatesViewport {
            super.layoutSubviews()
        } else {
            UIView.performWithoutAnimation { super.layoutSubviews() }
        }
        defer { viewportChanged?() }
        // A blocked pass leaves what it saw for the first idle one, so a change during a drag is not forgotten.
        guard !adjustingOffset, !userIsScrolling, !scrollingToTarget, bounds.height > 0 else {
            contentChangePending = true
            return
        }
        let currentGeometry = geometry
        // Following holds on every idle pass, so a native offset change while typing returns to the latest message.
        let needsRestoration = viewport.followsLatest || contentChangePending || measuredGeometry != currentGeometry
        measuredGeometry = currentGeometry
        contentChangePending = false
        if revealExpansion() { return }
        guard needsRestoration else { return }
        let anchorOffset = readingAnchor.flatMap { anchor in
            itemTop?(anchor.id).map { anchor.offset(itemTop: $0, inset: adjustedContentInset.top) }
        }
        if let offset = viewport.offset(geometry: geometry, readingAnchor: anchorOffset),
            abs(contentOffset.y - offset) >= 1
        {
            adjustingOffset = true
            let target = CGPoint(x: contentOffset.x, y: offset)
            if animatesViewport {
                contentOffset = target
            } else {
                UIView.performWithoutAnimation { contentOffset = target }
            }
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
    var onNearTop: () -> Void = {}
    var onViewportHeightChanged: (CGFloat) -> Void = { _ in }
    private var lastScrollCommand = 0
    private var lastItemScrollCommand = 0
    private var requestedItem: String?
    private var messagesBelow = false
    private let client: any MachineRequesting
    private let chatID: String
    private let uiModels: ChatUiModels?
    private let workspace: MobileWorkspace?
    private var presentation: ChatPresentation
    init(
        client: any MachineRequesting, chatID: String, presentation: ChatPresentation, uiModels: ChatUiModels? = nil,
        workspace: MobileWorkspace? = nil
    ) {
        self.presentation = presentation
        self.lastItemScrollCommand = presentation.scrollRequest
        self.client = client
        self.chatID = chatID
        self.uiModels = uiModels
        self.workspace = workspace
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    private var collection: ChatTimelineCollection!
    private var source: UICollectionViewDiffableDataSource<Int, String>!
    private var items: [String: ChatTimelineEntry] = [:]
    private var paddings: [String: ChatRowPadding] = [:]
    private var lastRevision = -1
    private var pendingUpdate: ([ChatTimelineEntry], Int)?
    private var displayLink: CADisplayLink?
    private var applyingSnapshot = false
    private var composerHost: UIHostingController<AnyView>?
    private var composerFade: ChatComposerFade?
    private var composerFadeTop: NSLayoutConstraint?
    private var composerFadeStart: CGFloat = 0
    private var composerAboveHome: NSLayoutConstraint?
    private var latestButtonHost: UIHostingController<AnyView>?
    private var statusHost: UIHostingController<AnyView>?
    private var statusContainer: UIView?
    private var statusTopConstraint: NSLayoutConstraint?
    private var statusBottomConstraint: NSLayoutConstraint?
    private var viewportInsets = UIEdgeInsets.zero
    private var reportedViewportHeight: CGFloat = 0
    private var fullHeightConstraint: NSLayoutConstraint!
    private var keyboardHeightConstraint: NSLayoutConstraint!
    private var loggedLayout = ""

    override func loadView() {
        view = ChatTimelineRootView()
    }

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
        collection.viewportChanged = { [weak self] in self?.reportViewportPosition() }
        answerVisibleEntries()
        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissComposerKeyboard))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        collection.addGestureRecognizer(tap)
        collection.captureReadingAnchor = { [weak self] in self?.visibleAnchor() }
        collection.itemFrame = { [weak self] id in
            guard let self, let index = self.source.indexPath(for: id) else { return nil }
            return self.collection.layoutAttributesForItem(at: index)?.frame
        }
        collection.itemTop = { [weak self] id in self?.collection.itemFrame?(id)?.minY }
        view.addSubview(collection)
        setContentScrollView(collection, for: .top)
        view.keyboardLayoutGuide.usesBottomSafeArea = false
        fullHeightConstraint = collection.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        keyboardHeightConstraint = collection.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        NSLayoutConstraint.activate([
            collection.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collection.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collection.topAnchor.constraint(equalTo: view.topAnchor),
            fullHeightConstraint,
        ])
        let registration = UICollectionView.CellRegistration<ChatHostingCell, String> {
            [weak self] cell, _, id in
            guard let self, let item = self.items[id] else { return }
            cell.host(in: self) {
                ChatEntryView(
                    entry: item, presentation: self.presentation, client: self.client, chatID: self.chatID,
                    workspace: self.workspace
                )
                .environment(\.chatUiModels, self.uiModels)
                .id(id)
                .environment(
                    \.chatWillExpand,
                    ChatWillExpandAction(id: id) { [weak self] expanding, headerOffset in
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
                .padding(.horizontal, ChatTimeline.rowInset)
                .padding(.top, self.paddings[id]?.top ?? ChatRowPadding.prose)
                .padding(.bottom, self.paddings[id]?.bottom ?? ChatRowPadding.prose)
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
        answerVisibleEntries()
    }

    private func answerVisibleEntries() {
        presentation.visibleEntryIDs = { [weak self] in
            guard let self, self.collection != nil else { return [] }
            return self.visibleRows().rows.map(\.id)
        }
    }

    /// The rows that show between the insets, top to bottom, and where that visible part starts.
    private func visibleRows() -> (top: CGFloat, rows: [(id: String, frame: CGRect)]) {
        let top = collection.contentOffset.y + collection.adjustedContentInset.top
        let bottom = collection.contentOffset.y + collection.bounds.height - collection.adjustedContentInset.bottom
        let rows = collection.indexPathsForVisibleItems.sorted().compactMap { index -> (id: String, frame: CGRect)? in
            guard let id = source.itemIdentifier(for: index),
                let frame = collection.layoutAttributesForItem(at: index)?.frame, frame.maxY > top, frame.minY < bottom
            else { return nil }
            return (id, frame)
        }
        return (top, rows)
    }

    func setViewportInsets(top: CGFloat, bottom: CGFloat) {
        loadViewIfNeeded()
        viewportInsets = UIEdgeInsets(top: max(0, top), left: 0, bottom: max(0, bottom), right: 0)
        updateViewportInsets()
    }

    private func updateViewportInsets() {
        var insets = viewportInsets
        if let composerCover { insets.bottom = composerCover }
        statusTopConstraint?.constant = insets.top
        statusBottomConstraint?.constant = -insets.bottom
        guard collection.contentInset != insets else { return }
        collection.prepareForContentChange()
        collection.contentInset = insets
        collection.verticalScrollIndicatorInsets = insets
        collection.setNeedsLayout()
        collection.layoutIfNeeded()
    }

    /// How much of the timeline's bottom the composer covers, the gap under it included.
    private var composerCover: CGFloat? {
        composerHost.map { max(0, collection.frame.maxY - $0.view.frame.minY) }
    }

    func setComposer(_ content: AnyView?, latestButton: AnyView?) {
        loadViewIfNeeded()
        guard let content else {
            removeHost(&latestButtonHost)
            removeHost(&composerHost)
            composerFade?.removeFromSuperview()
            composerFade = nil
            composerFadeTop = nil
            composerAboveHome = nil
            keyboardHeightConstraint.isActive = false
            fullHeightConstraint.isActive = true
            view.keyboardLayoutGuide.keyboardDismissPadding = 0
            return
        }
        if let composerHost {
            composerHost.rootView = content
        } else {
            let host = ChatComposerHost(rootView: content)
            host.laidOut = { [weak self] in self?.updateComposerCover() }
            install(host)
            composerHost = host
            chatPresentationLog.notice("composer host added")
            // One UIKit layout owns both frames, including interactive keyboard movement.
            fullHeightConstraint.isActive = false
            keyboardHeightConstraint.isActive = true
            // On the keyboard while it is up, and half the home indicator's area up while it is down, which sits the
            // pills close to the edge without meeting its corners. The timeline keeps running behind the composer.
            let onKeyboard = host.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
            onKeyboard.priority = .defaultHigh
            let aboveHome = host.view.bottomAnchor.constraint(
                lessThanOrEqualTo: view.bottomAnchor, constant: -view.safeAreaInsets.bottom / 2)
            composerAboveHome = aboveHome
            let fade = ChatComposerFade()
            view.insertSubview(fade, aboveSubview: collection)
            composerFade = fade
            let fadeTop = fade.topAnchor.constraint(equalTo: host.view.topAnchor)
            composerFadeTop = fadeTop
            NSLayoutConstraint.activate([
                host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                host.view.bottomAnchor.constraint(lessThanOrEqualTo: view.keyboardLayoutGuide.topAnchor),
                aboveHome, onKeyboard,
                fade.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                fade.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                fadeTop,
                fade.bottomAnchor.constraint(equalTo: collection.bottomAnchor),
            ])
        }
        composerFadeTop?.constant = composerFadeStart + ChatComposerFade.band
        if let latestButton, let composerHost {
            if let latestButtonHost {
                latestButtonHost.rootView = latestButton
            } else {
                let host = addHost(latestButton)
                latestButtonHost = host
                NSLayoutConstraint.activate([
                    host.view.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                    // The dock carries 12 pt of padding above its first row, so this leaves 16 pt to what shows.
                    host.view.bottomAnchor.constraint(equalTo: composerHost.view.topAnchor, constant: -4),
                    host.view.widthAnchor.constraint(equalToConstant: 44),
                    host.view.heightAnchor.constraint(equalToConstant: 44),
                ])
            }
        } else {
            removeHost(&latestButtonHost)
        }
    }

    func setStatus(_ content: AnyView?) {
        loadViewIfNeeded()
        guard let content else {
            removeHost(&statusHost)
            statusContainer?.removeFromSuperview()
            statusContainer = nil
            statusTopConstraint = nil
            statusBottomConstraint = nil
            return
        }
        // Keep SwiftUI at its intrinsic height so UIKit animates its position with the keyboard.
        let sizedContent = AnyView(content.fixedSize(horizontal: false, vertical: true))
        if let statusHost {
            statusHost.rootView = sizedContent
        } else {
            let container = UIView()
            container.translatesAutoresizingMaskIntoConstraints = false
            container.isUserInteractionEnabled = false
            container.clipsToBounds = true
            view.addSubview(container)
            statusContainer = container
            let top = container.topAnchor.constraint(equalTo: collection.topAnchor)
            let bottom = container.bottomAnchor.constraint(equalTo: collection.bottomAnchor)
            statusTopConstraint = top
            statusBottomConstraint = bottom
            let host = addHost(sizedContent, in: container)
            statusHost = host
            NSLayoutConstraint.activate([
                container.leadingAnchor.constraint(equalTo: collection.leadingAnchor),
                container.trailingAnchor.constraint(equalTo: collection.trailingAnchor),
                top, bottom,
                host.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                host.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                host.view.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            ])
        }
        updateViewportInsets()
    }

    private func addHost(_ content: AnyView, in container: UIView? = nil) -> UIHostingController<AnyView> {
        let host = UIHostingController(rootView: content)
        install(host, in: container)
        return host
    }

    private func install(_ host: UIHostingController<AnyView>, in container: UIView? = nil) {
        host.safeAreaRegions = []
        host.sizingOptions = [.intrinsicContentSize]
        host.view.backgroundColor = .clear
        host.view.tintColor = MobileStyle.accentColor
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        (container ?? view).addSubview(host.view)
        host.didMove(toParent: self)
    }

    private func removeHost(_ host: inout UIHostingController<AnyView>?) {
        guard let removing = host else { return }
        removing.willMove(toParent: nil)
        removing.view.removeFromSuperview()
        removing.removeFromParent()
        host = nil
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        composerAboveHome?.constant = -view.safeAreaInsets.bottom / 2
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateComposerCover()
        let height = max(0, collection.bounds.height - viewportInsets.top)
        if height != reportedViewportHeight {
            reportedViewportHeight = height
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.onViewportHeightChanged(self.reportedViewportHeight)
            }
        }
        logLayout()
    }

    private func updateComposerCover() {
        updateViewportInsets()
        if let composerCover, view.keyboardLayoutGuide.keyboardDismissPadding != composerCover {
            view.keyboardLayoutGuide.keyboardDismissPadding = composerCover
        }
    }

    /// Every frame the screen is made of, logged when it moved; a collapse is an error, so it shows without debug
    /// messages.
    private func logLayout() {
        let keyboard = view.keyboardLayoutGuide.layoutFrame
        let composer = composerHost?.view.frame ?? .zero
        let safe = view.safeAreaInsets
        let line =
            "view \(Int(view.bounds.width))x\(Int(view.bounds.height)) window \(view.window != nil) "
            + "safe \(Int(safe.top))/\(Int(safe.bottom)) keyboard \(Int(keyboard.minY))+\(Int(keyboard.height)) "
            + "timeline \(Int(collection.frame.minY))+\(Int(collection.frame.height)) "
            + "composer \(Int(composer.minY))+\(Int(composer.height)) inset \(Int(collection.contentInset.bottom))"
        guard line != loggedLayout else { return }
        loggedLayout = line
        let collapsed =
            view.window == nil || view.bounds.height < 1 || keyboard.minY < safe.top
            || collection.frame.height < view.bounds.height / 3
            || (composerHost != nil && (composer.minY < safe.top || composer.height < 1))
        if collapsed {
            chatPresentationLog.error("layout collapsed: \(line, privacy: .public)")
        } else {
            chatPresentationLog.debug("layout \(line, privacy: .public)")
        }
    }

    override func didMove(toParent parent: UIViewController?) {
        super.didMove(toParent: parent)
        let name = parent.map { String(describing: type(of: $0)) } ?? "no parent"
        chatPresentationLog.notice("timeline moved to \(name, privacy: .public)")
    }

    func setComposerFadeStart(_ start: CGFloat) {
        composerFadeStart = start
        composerFadeTop?.constant = start + ChatComposerFade.band
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

    /// A page that waits to go in has not moved the reader away from the top yet, so it asks for none.
    func askForEarlierNearTop() {
        guard pendingUpdate == nil, !applyingSnapshot, collection.geometry.isNearTop(collection.contentOffset.y) else {
            return
        }
        DispatchQueue.main.async { [weak self] in self?.onNearTop() }
    }

    private func reportViewportPosition() {
        askForEarlierNearTop()
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
        let previousPaddings = paddings
        let entries = values
        items = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        paddings = Dictionary(
            zip(entries.map(\.id), ChatRowPadding.rows(entries.map(\.rhythm))),
            uniquingKeysWith: { _, newest in newest })
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
        let changed = ids.filter {
            existing.contains($0) && (previous[$0] != items[$0] || previousPaddings[$0] != paddings[$0])
        }
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
        let visible = visibleRows()
        return visible.rows.first.map { ChatReadingAnchor(id: $0.id, distanceFromTop: $0.frame.minY - visible.top) }
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) { collection.beginUserScroll() }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { reportViewportPosition() }
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
        chatPresentationLog.notice("timeline appeared")
        scheduleUpdate()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        chatPresentationLog.notice("timeline disappeared")
        displayLink?.invalidate()
        displayLink = nil
    }
}

/// The composer's host, which tells the timeline each time it laid itself out: the composer can settle its height
/// after the timeline's own pass, and the latest message would then sit under the field until the next one.
private final class ChatComposerHost: UIHostingController<AnyView> {
    var laidOut: (() -> Void)?

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        laidOut?()
    }
}

/// Logs the tint going dim and back, which is how the chat sees a menu, sheet or alert open over it, with what the
/// window presents at that moment.
private final class ChatTimelineRootView: UIView {
    override func tintColorDidChange() {
        super.tintColorDidChange()
        var presented: [String] = []
        var next = window?.rootViewController?.presentedViewController
        while let controller = next {
            presented.append(String(describing: type(of: controller)))
            next = controller.presentedViewController
        }
        let tint = tintAdjustmentMode == .dimmed ? "dimmed" : "normal"
        let over = presented.isEmpty ? "nothing" : presented.joined(separator: " > ")
        chatPresentationLog.notice("tint \(tint, privacy: .public), presented: \(over, privacy: .public)")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        chatPresentationLog.notice("timeline \(self.window == nil ? "left" : "entered", privacy: .public) the window")
    }
}

/// Covers the timeline under the composer and fades it out along the composer's top edge, so a message does not show
/// through the glass. A cover rather than a mask on the timeline, which would render every scrolled frame offscreen.
@MainActor
private final class ChatComposerFade: UIView {
    static let band: CGFloat = 72
    private let edge = UIView()
    private let gradient = CAGradientLayer()

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        isUserInteractionEnabled = false
        backgroundColor = MobileStyle.surfaceColor
        edge.backgroundColor = MobileStyle.surfaceColor
        // Eased, so a message stays readable well into the field before it goes.
        gradient.colors = [0, 0.2, 0.55, 1].map { UIColor.black.withAlphaComponent($0).cgColor }
        gradient.locations = [0, 0.4, 0.75, 1]
        edge.layer.mask = gradient
        addSubview(edge)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func layoutSubviews() {
        super.layoutSubviews()
        edge.frame = CGRect(x: 0, y: -Self.band, width: bounds.width, height: Self.band)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gradient.frame = edge.bounds
        CATransaction.commit()
    }
}

final class ChatHostingCell: UICollectionViewListCell {
    private let hosting = UIHostingController(rootView: AnyView(EmptyView()))
    private var resizePending = false

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
        hosting.rootView = AnyView(
            content()
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGSize.self) {
                    $0.size
                } action: { [weak self] size in
                    self?.contentSizeChanged(size)
                }
        )
        hosting.view.invalidateIntrinsicContentSize()
    }

    override func preferredLayoutAttributesFitting(_ layoutAttributes: UICollectionViewLayoutAttributes)
        -> UICollectionViewLayoutAttributes
    {
        let attributes = layoutAttributes.copy() as! UICollectionViewLayoutAttributes
        let size = hosting.sizeThatFits(in: CGSize(width: attributes.size.width, height: .greatestFiniteMagnitude))
        attributes.size.height = ceil(size.height)
        return attributes
    }

    private func contentSizeChanged(_ size: CGSize) {
        // Intrinsic sizing uses an unspecified width, so wrapping can grow without changing that ideal height.
        guard abs(size.width - contentView.bounds.width) < 1,
            abs(ceil(size.height) - bounds.height) >= 1, !resizePending
        else { return }
        resizePending = true
        // SwiftUI can report several sizes while parsing Markdown. Invalidate outside its current layout pass.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.resizePending = false
            UIView.performWithoutAnimation {
                self.contentView.invalidateIntrinsicContentSize()
                self.invalidateIntrinsicContentSize()
            }
        }
    }
}

extension EnvironmentValues {
    @Entry var chatWillExpand = ChatWillExpandAction()
}

struct ChatWillExpandAction: Equatable {
    private let id: String?
    private let action: (Bool, CGFloat) -> Void

    init(id: String? = nil, action: @escaping (Bool, CGFloat) -> Void = { _, _ in }) {
        self.id = id
        self.action = action
    }

    func callAsFunction(_ expanding: Bool, _ headerOffset: CGFloat) {
        action(expanding, headerOffset)
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id
    }
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
        VStack(alignment: .leading, spacing: 0) {
            ChatExpansionButton(expanding: !configuration.isExpanded) {
                configuration.isExpanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    configuration.label
                    Spacer(minLength: 0)
                    Image(lucide: configuration.isExpanded ? "chevron-down" : "chevron-right", size: 12)
                        .foregroundStyle(MobileStyle.muted)
                }
                .frame(minHeight: 28).contentShape(Rectangle())
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
    var workspace: MobileWorkspace?
    @Environment(\.chatUiModels) private var uiModels
    @State private var expanded = false

    var body: some View {
        Group {
            switch entry.kind {
            case .activity: ChatWorkingRow(presentation: presentation)
            case .turnFold:
                if let record = entry.items.first, let turn = record.item.turnItem {
                    let turnID = turn.turnId ?? turn.id
                    HStack(spacing: 10) {
                        ChatExpansionButton(expanding: !presentation.expandedTurns.contains(turnID)) {
                            presentation.toggleTurn(turnID)
                        } label: {
                            // A line and not a button, like the tool lines it hides; the work reads fainter than the time.
                            HStack(spacing: 8) {
                                Image(
                                    lucide: presentation.expandedTurns.contains(turnID)
                                        ? "chevron-down" : "chevron-right",
                                    size: 12)
                                Text(ChatPresentation.turnLabel(turn, items: entry.items.map(\.item)))
                                    .layoutPriority(1)
                                let work = ChatToolPresentation.turnSummary(entry.items.compactMap(\.item.toolItem))
                                if !work.isEmpty {
                                    Text(ChatToolPresentation.turnLine(work)).foregroundStyle(MobileStyle.faint)
                                }
                            }
                            .font(.footnote).lineLimit(1).foregroundStyle(
                                turn.state == .error ? MobileStyle.statusError : MobileStyle.muted
                            )
                            .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                            .accessibilityValue(presentation.expandedTurns.contains(turnID) ? "Expanded" : "Collapsed")
                            .modifier(ChatForkMenu(presentation: presentation, turnID: record.id))
                    }
                }
            case .forks:
                if let turn = entry.items.first {
                    ChatForksRow(forkIDs: presentation.forks[turn.id] ?? [], presentation: presentation)
                }
            case .turnStart:
                if let turn = entry.items.first?.item.turnItem {
                    let task = turn.taskToolUseId ?? ""
                    Button {
                        presentation.openSubagent(toolUseID: task)
                    } label: {
                        Label(ChatPresentation.agentTurnLabel(turn), lucideIcon: "bot", iconSize: 14)
                            .lineLimit(1).font(.footnote).foregroundStyle(MobileStyle.muted).frame(minHeight: 28)
                    }.buttonStyle(.plain).disabled(task.isEmpty)
                }
            case .changedFiles:
                if let turn = entry.items.first {
                    ChatChangedFilesRow(
                        turn: turn, tools: Array(entry.items.dropFirst()), client: client, chatID: chatID)
                }
            case .subagent:
                if let branch = entry.branch {
                    ChatSubagentRow(branch: branch, presentation: presentation)
                }

            case .message:
                if let item = entry.items.first {
                    ChatObservedRow(record: item, client: client, chatID: chatID, presentation: presentation)
                }
            case .liveThought:
                if let record = entry.items.first, case .thinking(let thought) = record.item {
                    ChatLiveThoughtRow(item: thought)
                }
            case .visual:
                if let visual = entry.visual {
                    ChatVisualCard(visual: visual, presentation: presentation, client: client, chatID: chatID)
                }
            case .output:
                if let card = entry.output {
                    ChatOutputCardView(card: card, presentation: presentation, client: client)
                }
            case .tools:
                DisclosureGroup(isExpanded: $expanded) {
                    ForEach(entry.items) { item in
                        ChatObservedRow(record: item, client: client, chatID: chatID, presentation: presentation)
                    }
                } label: {
                    let tools = entry.items.compactMap(\.item.toolItem)
                    let running = tools.filter { $0.state == .running }.count
                    let failed = tools.contains { $0.state == .error }
                    HStack(spacing: 8) {
                        if running > 0 {
                            Spinner(size: 12).foregroundStyle(MobileStyle.statusRunning)
                        } else {
                            ChatToolMarkView(
                                mark: failed
                                    ? .lucide("circle-alert")
                                    : tools.first.map(ChatToolPresentation.mark) ?? .lucide("wrench"))
                        }
                        if running > 0 {
                            Text("\(tools.count) tool calls").lineLimit(1)
                            Text("\(running) running").foregroundStyle(MobileStyle.faint).fixedSize()
                        } else {
                            Text(ChatToolPresentation.groupLabel(tools).attributed).lineLimit(1)
                        }
                    }
                    .font(.footnote).monospacedDigit()
                    .foregroundStyle(failed ? MobileStyle.statusError : MobileStyle.muted)
                }
            }
        }
        .modifier(
            ChatLinkRouting(
                context: ChatContentContext(
                    client: client, chatID: chatID, cwd: presentation.cwd, workspace: workspace,
                    connected: presentation.connected, scopeID: uiModels?.scopeID,
                    referenced: presentation.referenced))
        )
        .background { ChatRowFlashLight(presentation: presentation, entryID: entry.id) }
        .frame(maxWidth: entry.visual?.wide == true ? .infinity : 720, alignment: .leading)
        .frame(maxWidth: .infinity)
    }
}

/// The light over a row a jump landed on, which fades as the desktop's does. Its own view, so only the row it lights
/// draws again when a jump lands.
private struct ChatRowFlashLight: View {
    let presentation: ChatPresentation
    let entryID: String
    @State private var lit = false

    var body: some View {
        let flash = presentation.flash?.entryID == entryID ? presentation.flash : nil
        RoundedRectangle(cornerRadius: 10)
            .fill(MobileStyle.accent.opacity(lit ? 0.18 : 0))
            .padding(-4)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task(id: flash?.nonce) {
                guard let flash, flash.fresh else { return }
                lit = true
                try? await Task.sleep(for: .milliseconds(100))
                withAnimation(.easeOut(duration: 1.6)) { lit = false }
            }
    }
}

struct ChatObservedRow: View {
    let record: ChatItemState
    let client: any MachineRequesting
    let chatID: String
    /// The thread the row stands in, when that thread can fork or lead to another chat.
    var presentation: ChatPresentation?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let bookmark = bookmarkable ? presentation?.bookmarks[record.id] : nil {
                ChatBookmarkMarker(bookmark: bookmark).frame(maxWidth: 720).frame(maxWidth: .infinity)
            }
            ChatTimelineRow(record: record, client: client, chatID: chatID, presentation: presentation)
                .modifier(
                    ChatMessageMenu(
                        text: ChatSubagents.handbackReport(record.item) ?? text,
                        presentation: forkable ? presentation : nil, turnID: record.item.turnId ?? "",
                        bookmarks: bookmarkable ? presentation : nil, itemID: record.id))
        }
    }

    private var text: String {
        switch record.item {
        case .user(let message): message.text
        case .assistant(let reply): reply.text
        case .thinking(let thought): thought.text
        case .note(let note): note.message?.text ?? (note.said == true ? ChatRuimteSaid.words(note.text) : note.text)
        default: ""
        }
    }

    /// Whether this row can carry a bookmark: a message of the chat's own thread.
    private var bookmarkable: Bool { presentation?.forkable == true && ChatBookmarks.markable(record.item) }

    /// Whether "Fork from here" belongs on this row: what the person asked or the answer of a turn.
    private var forkable: Bool {
        switch record.item {
        case .user, .assistant: record.item.turnId != nil && record.item.parentToolUseID == nil
        default: false
        }
    }
}

private struct ChatTimelineRow: View {
    let record: ChatItemState
    let client: any MachineRequesting
    let chatID: String
    let presentation: ChatPresentation?
    @Environment(\.chatUiModels) private var uiModels
    @Environment(\.chatContent) private var context
    var body: some View {
        content
            .frame(maxWidth: 720, alignment: record.item.userItem != nil ? .trailing : .leading)
            .frame(maxWidth: .infinity)
            .tint(MobileStyle.accent)
    }

    private var imageSave: (@MainActor (JSONValue) async throws -> String?)? {
        guard let uiModels, uiModels.chatID == chatID, context?.workspace != nil, context?.connected == true else {
            return nil
        }
        return { attachment in
            try await uiModels.imageSave.open(attachmentID: attachment.text("id"))
        }
    }

    /// Only the chat's own reply can hand a command to a terminal, never a sub-agent's text.
    private func replySource(_ reply: ChatAssistantItem) -> ChatReplySource? {
        record.item.parentToolUseID == nil ? ChatReplySource(itemID: reply.id, streaming: reply.streaming) : nil
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch record.item {
            case .user(let message):
                ChatUserMessage(item: message, client: client, chatID: chatID, presentation: presentation)
            case .assistant(let reply):
                Group {
                    if let trees = record.replyTrees, let uiModels, uiModels.chatID == chatID {
                        UiReplyView(item: reply, trees: trees, presentation: presentation) { block in
                            uiModels.cache.model(itemID: reply.id, block: block)
                        }
                    } else {
                        ChatStreamingMessage(text: reply.text, streaming: reply.streaming)
                    }
                }
                .environment(\.markdownTableBleed, ChatTimeline.rowInset)
                .environment(\.chatNamesReferences, true)
                .environment(\.chatReplySource, replySource(reply))
                .accessibilityElement(children: .contain).accessibilityLabel("Agent")
            case .thinking(let thought):
                ChatThinkingRow(item: thought)
            case .tool(let tool):
                if let report = ChatSubagents.handbackReport(record.item) {
                    Text("Report").font(.caption.weight(.medium)).foregroundStyle(MobileStyle.faint)
                        .accessibilityAddTraits(.isHeader)
                    MarkdownMessage(text: report)
                } else if UiGeneratedImage.isGeneration(tool) {
                    GeneratedImageRow(item: tool, saveToProject: imageSave)
                } else if let workflow = tool.workflow {
                    ChatWorkflowRow(item: tool, workflow: workflow, presentation: presentation)
                } else {
                    ChatToolRow(
                        item: tool, awaitingApproval: presentation?.awaitingApproval.contains(tool.toolUseId) == true)
                }
            case .subagent(let agent):
                DisclosureGroup(agent.description) {
                    Text(SubagentStatusWord(agent.status).title).font(.caption)
                    MarkdownMessage(text: agent.result ?? agent.summary ?? agent.prompt ?? "")
                }
            case .approval(let approval):
                ChatApprovalHistoryLine(approval: approval)
            case .question(let asked):
                ForEach(Array(asked.questions.enumerated()), id: \.offset) { _, question in
                    Label(question.question, lucideIcon: "message-circle-question-mark", iconSize: 14).font(
                        .subheadline)
                    if let answer = asked.answers?[question.id] {
                        Text(answer).font(.subheadline)
                    } else {
                        Text(asked.state == .dismissed ? "Dismissed" : "Not answered").font(.caption)
                            .foregroundStyle(MobileStyle.muted)
                    }
                }
            case .note(let note):
                if let message = note.message {
                    ChatSentMessage(message: message)
                } else if note.said == true {
                    ChatRuimteSaid(text: note.text)
                } else {
                    ChatNoteRow(item: note, presentation: presentation)
                }
            case .turn(let turn):
                Label(
                    turn.label
                        ?? String(
                            localized: "Turn \(turn.state.rawValue)",
                            comment: "%@ is the state of the turn as the machine names it"),
                    lucideIcon: "circle-dashed", iconSize: 14
                ).font(.caption).foregroundStyle(MobileStyle.muted)
                if let files = turn.checkpointDiff?.files, !files.isEmpty {
                    DisclosureGroup("\(files.count) changed files") {
                        ForEach(Array(files.enumerated()), id: \.offset) { _, file in
                            Text(file.path).font(.caption.bold())
                            CodeMessage(text: file.diff)
                        }
                    }
                }
            case .compaction(let compaction):
                ChatCompactionRule(preTokens: compaction.preTokens.map(Double.init))
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The outcome of a permission request, one quiet line with what the call was about; the request itself lived on the
/// composer.
private struct ChatApprovalHistoryLine: View {
    let approval: ChatApprovalItem

    var body: some View {
        let denied = approval.decision == .deny
        let summary = ChatToolPresentation.summary(name: approval.toolName, input: approval.input)
        HStack(spacing: 8) {
            Image(lucide: denied ? "x" : "check", size: 14)
                .foregroundStyle(denied ? MobileStyle.statusError : MobileStyle.faint)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Self.decisionWord(approval.decision))
                    .foregroundStyle(denied ? MobileStyle.statusError : MobileStyle.faint)
                Text(approval.toolName).foregroundStyle(MobileStyle.muted)
                if !summary.isEmpty {
                    Text(summary).font(.system(.caption, design: .monospaced)).foregroundStyle(MobileStyle.faint)
                        .truncationMode(
                            ChatToolPresentation.summaryIsPath(name: approval.toolName, input: approval.input)
                                ? .middle : .tail
                        )
                        .layoutPriority(-1)
                }
            }
            .lineLimit(1)
        }
        .font(.caption)
        .frame(minHeight: 28)
        .accessibilityElement(children: .combine)
    }

    private static func decisionWord(_ decision: ChatApprovalDecision) -> String {
        switch decision {
        case .allow: String(localized: "Allowed")
        case .allowAlways: String(localized: "Always allowed")
        case .deny: String(localized: "Denied")
        case .cancelled: String(localized: "No longer needed")
        case .pending: decision.rawValue
        }
    }
}
