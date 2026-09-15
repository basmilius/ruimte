import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct ChatTimeline: UIViewControllerRepresentable {
    let items: [JSONValue]
    let revision: Int
    let client: any MachineRequesting
    let chatID: String

    func makeUIViewController(context: Context) -> ChatTimelineController {
        ChatTimelineController(client: client, chatID: chatID)
    }
    func updateUIViewController(_ controller: ChatTimelineController, context: Context) {
        controller.update(items: items, revision: revision)
    }
}

struct ChatViewportGeometry {
    let contentHeight: CGFloat
    let height: CGFloat
    var topInset: CGFloat = 0
    var bottomInset: CGFloat = 0

    var bottom: CGFloat { max(-topInset, contentHeight - height + bottomInset) }
    func clamped(_ offset: CGFloat) -> CGFloat { min(bottom, max(-topInset, offset)) }
    func isNearBottom(_ offset: CGFloat) -> Bool { bottom - offset <= 80 }
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
        interactionRevision += 1
        followsLatest = false
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

@MainActor
final class ChatTimelineCollection: UICollectionView {
    private(set) var viewport = ChatViewportState()
    var captureReadingAnchor: (() -> ChatReadingAnchor?)?
    var itemTop: ((String) -> CGFloat?)?
    private var readingAnchor: ChatReadingAnchor?
    private var adjustingOffset = false

    var geometry: ChatViewportGeometry {
        ChatViewportGeometry(
            contentHeight: contentSize.height, height: bounds.height,
            topInset: adjustedContentInset.top, bottomInset: adjustedContentInset.bottom)
    }
    var userIsScrolling: Bool { isTracking || isDragging || isDecelerating || viewport.isInteracting }

    func prepareForContentChange() {
        if !viewport.followsLatest && !userIsScrolling { readingAnchor = captureReadingAnchor?() }
    }

    func beginUserScroll() {
        viewport.beginInteraction()
        readingAnchor = nil
    }

    func finishUserScroll() {
        viewport.finishInteraction(geometry: geometry, offset: contentOffset.y)
        readingAnchor = viewport.followsLatest ? nil : captureReadingAnchor?()
        setNeedsLayout()
    }

    func expandAtCurrentPosition() {
        viewport.readHere()
        readingAnchor = captureReadingAnchor?()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard !adjustingOffset, !userIsScrolling, bounds.height > 0 else { return }
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
final class ChatTimelineController: UIViewController, UICollectionViewDelegate {
    private let client: any MachineRequesting
    private let chatID: String
    init(client: any MachineRequesting, chatID: String) {
        self.client = client
        self.chatID = chatID
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    private var collection: ChatTimelineCollection!
    private var source: UICollectionViewDiffableDataSource<Int, String>!
    private var items: [String: ChatTimelineEntry] = [:]
    private var lastRevision = -1
    private var pendingUpdate: ([JSONValue], Int)?
    private var displayLink: CADisplayLink?
    private var applyingSnapshot = false

    override func viewDidLoad() {
        super.viewDidLoad()
        var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
        configuration.showsSeparators = false
        configuration.backgroundColor = .systemBackground
        collection = ChatTimelineCollection(
            frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout.list(using: configuration))
        collection.keyboardDismissMode = .interactive
        collection.alwaysBounceVertical = true
        collection.translatesAutoresizingMaskIntoConstraints = false
        collection.accessibilityIdentifier = "chat.timeline"
        collection.delegate = self
        collection.captureReadingAnchor = { [weak self] in self?.visibleAnchor() }
        collection.itemTop = { [weak self] id in
            guard let self, let index = self.source.indexPath(for: id) else { return nil }
            return self.collection.layoutAttributesForItem(at: index)?.frame.minY
        }
        view.addSubview(collection)
        NSLayoutConstraint.activate([
            collection.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collection.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collection.topAnchor.constraint(equalTo: view.topAnchor),
            collection.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        let registration = UICollectionView.CellRegistration<UICollectionViewListCell, String> {
            [weak self] cell, _, id in
            guard let self, let item = self.items[id] else { return }
            cell.contentConfiguration = UIHostingConfiguration {
                Group {
                    if item.isWork {
                        ChatWorkLog(
                            items: item.items, client: self.client, chatID: self.chatID,
                            onToggle: { [weak self] in self?.collection.expandAtCurrentPosition() })
                    } else if let message = item.items.first {
                        ChatTimelineRow(item: message, client: self.client, chatID: self.chatID)
                    }
                }
                .id(id)
                .transaction { transaction in
                    transaction.animation = nil
                    transaction.disablesAnimations = true
                }
            }.margins(.horizontal, 20).margins(.vertical, 10)
            cell.backgroundConfiguration = .clear()
        }
        source = UICollectionViewDiffableDataSource<Int, String>(collectionView: collection) { collection, index, id in
            collection.dequeueConfiguredReusableCell(using: registration, for: index, item: id)
        }
    }

    func update(items values: [JSONValue], revision: Int) {
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
        pendingUpdate = nil
        collection.prepareForContentChange()
        let interactionRevision = collection.viewport.interactionRevision
        let previous = items
        let entries = ChatTimelineEntry.group(values)
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
        source.apply(snapshot, animatingDifferences: false) { [weak self] in
            guard let self else { return }
            self.applyingSnapshot = false
            if self.lastRevision == revision,
                self.collection.viewport.interactionRevision == interactionRevision,
                !self.collection.userIsScrolling
            {
                self.collection.setNeedsLayout()
                self.collection.layoutIfNeeded()
            }
            self.scheduleUpdate()
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
    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { collection.finishUserScroll() }
    }
    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { collection.finishUserScroll() }

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

private struct ChatTimelineEntry: Equatable {
    let id: String
    let isWork: Bool
    var items: [JSONValue]

    static func group(_ values: [JSONValue]) -> [Self] {
        var entries: [Self] = []
        var seen = Set<String>()
        for item in values {
            guard let id = item["id"]?.stringValue, seen.insert(id).inserted else { continue }
            let isWork = ["tool", "thinking", "subagent"].contains(item["kind"]?.stringValue ?? "")
            if isWork, entries.last?.isWork == true {
                entries[entries.count - 1].items.append(item)
            } else {
                entries.append(Self(id: id, isWork: isWork, items: [item]))
            }
        }
        return entries
    }
}

private struct ChatWorkLog: View {
    let items: [JSONValue]
    let client: any MachineRequesting
    let chatID: String
    let onToggle: () -> Void
    @State private var expanded = false

    private var active: Bool {
        items.contains { $0["state"]?.stringValue == "running" || $0["status"]?.stringValue == "running" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                onToggle()
                expanded.toggle()
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "terminal").font(.footnote)
                    Text("Work log").font(.system(.footnote, design: .monospaced))
                    Text("· \(items.count)").font(.footnote).monospacedDigit()
                    if active { ProgressView().controlSize(.mini) }
                    Spacer(minLength: 0)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 11, weight: .medium))
                }
                .foregroundStyle(.secondary).frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityValue(expanded ? "Expanded" : "Collapsed")
            if expanded {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        ChatTimelineRow(item: item, client: client, chatID: chatID)
                    }
                }
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(MobileStyle.border).frame(width: 1) }
            }
        }
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
        .tint(MobileStyle.accent)
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
                VStack(alignment: .leading, spacing: 8) {
                    Text(item["text"]?.stringValue ?? "").textSelection(.enabled).lineSpacing(3)
                    ForEach(Array((item["attachments"]?.arrayValue ?? []).enumerated()), id: \.offset) {
                        _, attachment in
                        ChatAttachmentButton(client: client, chatID: chatID, attachment: attachment)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 18))
                .frame(maxWidth: 620, alignment: .trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .accessibilityLabel("You")
            case "assistant":
                MarkdownMessage(text: item["text"]?.stringValue ?? "")
            case "thinking":
                DisclosureGroup("Reasoning") { MarkdownMessage(text: item["text"]?.stringValue ?? "") }.foregroundStyle(
                    .secondary)
            case "tool":
                DisclosureGroup {
                    if let input = item["input"], let data = try? input.encoded(),
                        let text = String(data: data, encoding: .utf8)
                    {
                        CodeMessage(text: text)
                    }
                    CodeMessage(text: item["output"]?.stringValue ?? item["progress"]?["output"]?.stringValue ?? "")
                    ForEach(Array((item["changes"]?.arrayValue ?? []).enumerated()), id: \.offset) { _, change in
                        Text(change["path"]?.stringValue ?? "").font(.caption.bold())
                        CodeMessage(text: change["diff"]?.stringValue ?? "")
                    }
                } label: {
                    Image(
                        systemName: item["state"]?.stringValue == "error"
                            ? "exclamationmark.circle"
                            : item["state"]?.stringValue == "done" ? "checkmark.circle" : "terminal"
                    )
                    .font(.system(size: 14)).foregroundStyle(.secondary)
                    Text(item["name"]?.stringValue ?? "Tool").font(.subheadline).foregroundStyle(.secondary)
                    Spacer()
                    Text(item["state"]?.stringValue ?? "").font(.caption).foregroundStyle(.secondary)
                }.frame(minHeight: 44)
            case "subagent":
                DisclosureGroup(item["description"]?.stringValue ?? "Agent") {
                    Text(item["status"]?.stringValue ?? "").font(.caption)
                    MarkdownMessage(
                        text: item["result"]?.stringValue ?? item["summary"]?.stringValue ?? item["prompt"]?.stringValue
                            ?? "")
                }
            case "approval":
                HStack(spacing: 6) {
                    Image(systemName: "hand.raised")
                    Text(item["toolName"]?.stringValue ?? "Permission")
                    Text(item["decision"]?.stringValue ?? "")
                }.font(.caption).foregroundStyle(.secondary)
            case "question":
                Label("Questions", systemImage: "questionmark.circle")
                Text(item["state"]?.stringValue ?? "").font(.caption).foregroundStyle(.secondary)
                ForEach(Array((item["questions"]?.arrayValue ?? []).enumerated()), id: \.offset) { _, question in
                    Text(question["question"]?.stringValue ?? "").font(.subheadline)
                    if let id = question["id"]?.stringValue, let answer = item["answers"]?[id]?.stringValue {
                        Text(answer).foregroundStyle(.secondary)
                    }
                }
            case "turn":
                Label(
                    item["label"]?.stringValue ?? "Turn \(item["state"]?.stringValue ?? "")",
                    systemImage: "circle.dotted"
                ).font(.caption).foregroundStyle(.secondary)
                if let files = item["checkpointDiff"]?["files"]?.arrayValue, !files.isEmpty {
                    DisclosureGroup("\(files.count) changed files") {
                        ForEach(Array(files.enumerated()), id: \.offset) { _, file in
                            Text(file["path"]?.stringValue ?? "").font(.caption.bold())
                            CodeMessage(text: file["diff"]?.stringValue ?? file["omitted"]?.stringValue ?? "")
                        }
                    }
                }
            case "compaction":
                Label("Context compacted", systemImage: "arrow.down.right.and.arrow.up.left").font(.caption)
                    .foregroundStyle(.secondary)
            default: MarkdownMessage(text: item["text"]?.stringValue ?? "")
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
