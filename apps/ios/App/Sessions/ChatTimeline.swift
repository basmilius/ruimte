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
    let presentation: ChatPresentation
    let client: any MachineRequesting
    let chatID: String
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
        return ChatTimelineController(client: client, chatID: chatID, presentation: presentation)
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
/// field. It goes straight to the controller: as view state it re-rendered the screen from inside the composer's own
/// layout pass, which handed the composer a new root view and laid it out again, and the app hung in that loop.
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
        collection.itemTop = { [weak self] id in
            guard let self, let index = self.source.indexPath(for: id) else { return nil }
            return self.collection.layoutAttributesForItem(at: index)?.frame.minY
        }
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
                ChatEntryView(entry: item, presentation: self.presentation, client: self.client, chatID: self.chatID)
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
        answerVisibleEntries()
    }

    private func answerVisibleEntries() {
        presentation.visibleEntryIDs = { [weak self] in
            guard let self, self.collection != nil else { return [] }
            let top = self.collection.contentOffset.y + self.collection.adjustedContentInset.top
            let bottom =
                self.collection.contentOffset.y + self.collection.bounds.height
                - self.collection.adjustedContentInset.bottom
            return self.collection.indexPathsForVisibleItems.sorted().compactMap { index in
                guard let frame = self.collection.layoutAttributesForItem(at: index)?.frame,
                    frame.maxY > top, frame.minY < bottom
                else { return nil }
                return self.source.itemIdentifier(for: index)
            }
        }
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
                    host.view.bottomAnchor.constraint(equalTo: composerHost.view.topAnchor, constant: -20),
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

@MainActor
/// Covers the timeline under the composer and fades it out along the composer's top edge, so a message does not show
/// through the glass. A cover rather than a mask on the timeline, which would render every scrolled frame offscreen.
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
                    HStack(spacing: 10) {
                        ChatExpansionButton(
                            expanding: !presentation.expandedTurns.contains(
                                turn.value.text("turnId", fallback: turn.id))
                        ) {
                            presentation.toggleTurn(turn.value.text("turnId", fallback: turn.id))
                        } label: {
                            // A line and not a button, like the tool lines it hides; the work reads fainter than the time.
                            HStack(spacing: 8) {
                                Image(
                                    lucide: presentation.expandedTurns.contains(
                                        turn.value.text("turnId", fallback: turn.id))
                                        ? "chevron-down" : "chevron-right",
                                    size: 12)
                                Text(ChatPresentation.turnLabel(turn.value, items: entry.items.map(\.value)))
                                    .layoutPriority(1)
                                let work = ChatToolPresentation.turnSummary(
                                    entry.items.map(\.value).filter { $0.text("kind") == "tool" })
                                if !work.isEmpty {
                                    Text(work.map { "· \($0)" }.joined(separator: " "))
                                        .foregroundStyle(MobileStyle.faint)
                                }
                            }
                            .font(.footnote).lineLimit(1).foregroundStyle(
                                turn.value.text("state") == "error" ? Color.red : MobileStyle.muted
                            )
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                            .accessibilityValue(
                                presentation.expandedTurns.contains(turn.value.text("turnId", fallback: turn.id))
                                    ? "Expanded" : "Collapsed"
                            )
                            .modifier(ChatForkMenu(presentation: presentation, turnID: turn.id))
                    }
                }
            case .forks:
                if let turn = entry.items.first {
                    ChatForksRow(forkIDs: presentation.forks[turn.id] ?? [], presentation: presentation)
                }
            case .turnStart:
                if let turn = entry.items.first {
                    Button {
                        presentation.openSubagent(toolUseID: turn.value.text("taskToolUseId"))
                    } label: {
                        Label(ChatPresentation.agentTurnLabel(turn.value), lucideIcon: "bot", iconSize: 14)
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
                if let item = entry.items.first {
                    ChatObservedRow(record: item, client: client, chatID: chatID, presentation: presentation)
                }
            case .tools:
                if entry.items.count == 1, let item = entry.items.first {
                    ChatObservedRow(record: item, client: client, chatID: chatID, presentation: presentation)
                } else {
                    DisclosureGroup(isExpanded: $expanded) {
                        ForEach(entry.items) { item in
                            ChatObservedRow(record: item, client: client, chatID: chatID, presentation: presentation)
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
    /// The thread the row stands in, when that thread can fork or lead to another chat.
    var presentation: ChatPresentation?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let bookmark = bookmarkable ? presentation?.bookmarks[record.id] : nil {
                ChatBookmarkMarker(bookmark: bookmark).frame(maxWidth: 720).frame(maxWidth: .infinity)
            }
            ChatTimelineRow(item: record.value, client: client, chatID: chatID, presentation: presentation)
                .modifier(
                    ChatMessageMenu(
                        text: ChatSubagents.handbackReport(record.value) ?? record.value.text("text"),
                        presentation: forkable ? presentation : nil, turnID: record.value.text("turnId"),
                        bookmarks: bookmarkable ? presentation : nil, itemID: record.id))
        }
    }

    /// Whether this row can carry a bookmark: a message of the chat's own thread.
    private var bookmarkable: Bool { presentation?.forkable == true && ChatBookmarks.markable(record.value) }

    /// Whether "Fork from here" belongs on this row: what the person asked or the answer of a turn.
    private var forkable: Bool {
        let value = record.value
        return ["user", "assistant"].contains(value.text("kind")) && value["turnId"]?.stringValue != nil
            && value["parentToolUseId"]?.stringValue == nil
    }
}

private struct ChatTimelineRow: View {
    let item: JSONValue
    let client: any MachineRequesting
    let chatID: String
    let presentation: ChatPresentation?
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
                if let report = ChatSubagents.handbackReport(item) {
                    Text("Report").font(.caption.weight(.medium)).foregroundStyle(MobileStyle.faint)
                        .accessibilityAddTraits(.isHeader)
                    MarkdownMessage(text: report)
                } else {
                    ChatToolRow(item: item)
                }
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
                ChatNoteRow(item: item, presentation: presentation)
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
                ChatCompactionRule(preTokens: item["preTokens"]?.numberValue)
            default: MarkdownMessage(text: item["text"]?.stringValue ?? "")
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
