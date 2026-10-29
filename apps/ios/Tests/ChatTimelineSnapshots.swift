import Foundation
import RuimteIntelligentUI
import RuimtePulsar
import SwiftUI
import Testing
import UIKit

@testable import Ruimte

/// Renders parts of a chat's thread to PNG files for review against the desktop. Runs only when
/// `RUIMTE_CHAT_SNAPSHOTS` names a folder (`TEST_RUNNER_RUIMTE_CHAT_SNAPSHOTS` through `xcodebuild`), since it waits on
/// web views and layout.
@Suite(.serialized) @MainActor struct ChatTimelineSnapshots {
    private nonisolated static let folder = ProcessInfo.processInfo.environment["RUIMTE_CHAT_SNAPSHOTS"]

    private static let diagrams = [
        "flowchart LR\n  Phone[iPhone] -->|offer| Broker\n  Broker --> Machine\n  Machine -->|answer| Phone",
        "sequenceDiagram\n  participant P as Phone\n  participant M as Machine\n  P->>M: chat.attach\n  M-->>P: snapshot\n  M-)P: chat.event",
        "graph TD\n  A-->",
    ]

    @Test(.enabled(if: folder != nil)) func toolGroups() async throws {
        let client = ScriptedMachine()
        let presentation = ChatPresentation()
        let states = [["running"], ["done", "running", "done"], ["done", "done"], ["done", "error"]]
        let entries = states.enumerated().map { index, states in
            let records = states.enumerated().map { offset, state in
                ChatItemState(
                    ChatWire.item([
                        "id": .string("call-\(index)-\(offset)"), "kind": .string("tool"),
                        "name": .string("Bash"), "state": .string(state),
                        "input": .object(["command": .string("bun test")]),
                    ]).chatItem)
            }
            return ChatTimelineEntry(id: "tools-\(index)", kind: .tools, items: records)
        }
        for dark in [false, true] {
            let view = VStack(alignment: .leading, spacing: 20) {
                ForEach(entries) { entry in
                    ChatEntryView(entry: entry, presentation: presentation, client: client, chatID: "snapshot")
                }
                Spacer()
            }
            .padding(20)
            try await Self.render(view, name: "tool-groups-\(dark ? "dark" : "light")", dark: dark)
        }
    }

    @Test(.enabled(if: folder != nil)) func mermaidFences() async throws {
        let reply = "The connection goes through three steps:\n\n"
            + Self.diagrams.map { "```mermaid\n\($0)\n```" }.joined(separator: "\n\nAnd then:\n\n")
        let keys = Self.diagrams.map { MermaidLayout.Key(source: $0, font: MermaidFont(size: 15)) }
        for dark in [false, true] {
            try await Self.render(
                ScrollView { MarkdownMessage(text: reply).padding(16) }, name: "mermaid-\(dark ? "dark" : "light")",
                dark: dark
            ) { keys.allSatisfy { MermaidLayout.shared.cached($0) != nil } }
        }
    }

    private static func compiled(
        _ id: String, _ type: String, _ props: [String: JSONValue] = [:], _ children: [JSONValue] = []
    ) -> JSONValue {
        .object([
            "id": .string(id), "type": .string(type), "props": .object(props), "expressions": .object([:]),
            "bindings": .object([:]), "children": .array(children), "complete": .bool(true),
            "start": .number(0), "end": .number(1), "fallback": .string(""),
        ])
    }

    private static func text(_ id: String, _ words: String) -> JSONValue {
        compiled(id, "$text", ["text": .string(words)])
    }

    private static func block(_ id: String, _ nodes: [JSONValue]) -> JSONValue {
        .object([
            "id": .string(id), "catalogVersion": .number(1), "start": .number(0), "end": .number(1),
            "complete": .bool(true), "defaults": .object([:]), "queries": .object([:]), "revision": .string("r"),
            "diagnostics": .array([]), "fallback": .string(""), "nodes": .array(nodes),
        ])
    }

    private static let blocks: [JSONValue] = [
        block(
            "release",
            [
                compiled(
                    "s", "Summary", ["tone": .string("success"), "badge": .string("3 of 4 checks passed")],
                    [text("s1", "Release 0.24 is ready to tag")]),
                compiled(
                    "c", "Callout", ["tone": .string("warning"), "title": .string("One check is flaky")],
                    [text("c1", "The Linux shard timed out once on the packaged daemon.")]),
                compiled(
                    "steps", "Steps", [:],
                    [
                        compiled("st1", "Step", ["state": .string("done"), "detail": .string("2m 10s")], [text("t1", "Typecheck")]),
                        compiled("st2", "Step", ["state": .string("running")], [text("t2", "Unit tests on two shards")]),
                        compiled("st3", "Step", ["state": .string("pending")], [text("t3", "Packaged daemon")]),
                    ]),
                compiled(
                    "choices", "Choices", [:],
                    [
                        compiled("ch1", "Choice", ["primary": .bool(true), "context": .string("Tag v0.24.0 now")], [text("l1", "Tag the release")]),
                        compiled("ch2", "Choice", ["context": .string("Run the shard again first")], [text("l2", "Wait")]),
                    ]),
            ]),
        block(
            "numbers",
            [
                compiled(
                    "stats", "Stats", [:],
                    [
                        compiled("a", "Stat", ["label": .string("Tests"), "value": .number(4812), "previous": .number(4700)]),
                        compiled("b", "Stat", ["label": .string("Duration"), "value": .number(312), "unit": .string("s")]),
                    ]),
                compiled(
                    "timeline", "Timeline", [:],
                    [
                        compiled("e1", "Event", ["at": .string("2026-10-26T09:12:00Z"), "tone": .string("info"), "detail": .string("main")], [text("e1t", "Pushed")]),
                        compiled("e2", "Event", ["at": .string("2026-10-26T09:30:00Z"), "tone": .string("success")], [text("e2t", "CI green")]),
                    ]),
                compiled(
                    "sections", "Sections", [:],
                    [
                        compiled(
                            "sec", "Section", ["title": .string("What changed")],
                            [
                                text("sx", "Two fixes and one feature."),
                                compiled(
                                    "list", "EntityList", [:],
                                    [
                                        compiled("en1", "Entry", ["label": .string("Commits")], [text("en1t", "14")]),
                                        compiled("en2", "Entry", ["label": .string("Authors")], [text("en2t", "2")]),
                                    ]),
                            ]),
                    ]),
            ]),
    ]

    @Test(.enabled(if: folder != nil)) func intelligentUIBlocks() async throws {
        var models: [UiBlockModel] = []
        for block in Self.blocks {
            let model = UiBlockModel(chatID: "snapshot", itemID: "item", block: block) { _, _ in
                throw CancellationError()
            }
            await model.update(block: block)
            models.append(model)
        }
        defer { models.forEach { $0.stop() } }
        for dark in [false, true] {
            let view = ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Here is where the release stands.")
                    ForEach(Array(models.enumerated()), id: \.offset) { index, model in
                        UiBlockView(model: model, localKey: "snapshot-\(index)")
                    }
                }
                .padding(.horizontal, 20)
                .environment(\.uiBandBleed, 20)
            }
            try await Self.render(view, name: "ui-blocks-\(dark ? "dark" : "light")", dark: dark, size: CGSize(width: 402, height: 1400))
        }
    }

    static func render(
        _ view: some View, name: String, dark: Bool, size: CGSize = CGSize(width: 402, height: 874),
        until ready: () -> Bool = { true }
    ) async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.windowLevel = .alert + 1
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        window.rootViewController = UIHostingController(
            rootView: view.background(MobileStyle.surface).tint(MobileStyle.accent))
        window.isHidden = false
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }
        for _ in 0..<100 where !ready() {
            try await Task.sleep(for: .milliseconds(50))
        }
        // The web views of the drawings load their pages once the layout settled.
        try await Task.sleep(for: .milliseconds(1_200))
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let folder = URL(fileURLWithPath: try #require(Self.folder), isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try #require(image.pngData()).write(to: folder.appendingPathComponent("\(name).png"))
    }
}
