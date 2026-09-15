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

@MainActor
final class ChatTimelineController: UIViewController {
    private let client: any MachineRequesting
    private let chatID: String
    init(client: any MachineRequesting, chatID: String) {
        self.client = client
        self.chatID = chatID
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    private var collection: UICollectionView!
    private var source: UICollectionViewDiffableDataSource<Int, String>!
    private var items: [String: ChatTimelineEntry] = [:]
    private var lastRevision = -1
    private var pendingUpdate: ([JSONValue], Int)?
    private var displayLink: CADisplayLink?

    override func viewDidLoad() {
        super.viewDidLoad()
        var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
        configuration.showsSeparators = false
        configuration.backgroundColor = .systemBackground
        collection = UICollectionView(
            frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout.list(using: configuration))
        collection.keyboardDismissMode = .interactive
        collection.alwaysBounceVertical = true
        collection.translatesAutoresizingMaskIntoConstraints = false
        collection.accessibilityIdentifier = "chat.timeline"
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
                        ChatWorkLog(items: item.items, client: self.client, chatID: self.chatID)
                    } else if let message = item.items.first {
                        ChatTimelineRow(item: message, client: self.client, chatID: self.chatID)
                    }
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
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(flushUpdate))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func flushUpdate() {
        displayLink?.invalidate()
        displayLink = nil
        guard let (values, revision) = pendingUpdate else { return }
        pendingUpdate = nil
        let atBottom = collection.contentOffset.y + collection.bounds.height >= collection.contentSize.height - 100
        let previous = items
        let entries = ChatTimelineEntry.group(values)
        items = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0])
        let ids = entries.map(\.id)
        snapshot.appendItems(ids)
        let existing = Set(source.snapshot().itemIdentifiers)
        snapshot.reconfigureItems(ids.filter { existing.contains($0) && previous[$0] != items[$0] })
        lastRevision = revision
        source.apply(snapshot, animatingDifferences: false) { [weak self] in
            guard let self, atBottom, !ids.isEmpty else { return }
            self.collection.scrollToItem(at: IndexPath(item: ids.count - 1, section: 0), at: .bottom, animated: false)
        }
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
    @State private var expanded = false

    private var active: Bool {
        items.contains { $0["state"]?.stringValue == "running" || $0["status"]?.stringValue == "running" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
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
