import Foundation
@preconcurrency import Highlightr
import Observation
import SwiftUI
import UIKit

struct MarkdownMessage: View {
    let text: String
    var streaming = false
    @State private var blocks: [MarkdownBlock] = []
    @State private var parser = MarkdownBlockCache()
    @Environment(\.markdownReferences) private var inheritedReferences

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if blocks.isEmpty && !text.isEmpty { Text(text).hidden().accessibilityHidden(true) }
            MarkdownBlocksView(blocks: blocks, streaming: streaming)
        }
        .lineSpacing(4).textSelection(.enabled)
        .environment(
            \.markdownReferences,
            MarkdownInline.references(text).isEmpty ? inheritedReferences : MarkdownInline.references(text)
        )
        .task(id: text) {
            let parsed = await parser.parse(text)
            guard !Task.isCancelled else { return }
            blocks = parsed
        }
    }
}

private struct MarkdownBlocksView: View {
    let blocks: [MarkdownBlock]
    let streaming: Bool
    var body: some View {
        ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
            MarkdownBlockView(block: block, streaming: streaming)
        }
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    let streaming: Bool
    @Environment(\.chatContent) private var context
    @Environment(\.openURL) private var openURL

    @ViewBuilder var body: some View {
        switch block.kind {
        case .code(let language): CodeMessage(text: block.text, language: language)
        case .heading(let level):
            ChatInlineText(text: block.text, streaming: streaming)
                .font(level == 1 ? .title2.bold() : level == 2 ? .title3.bold() : .headline)
                .accessibilityAddTraits(.isHeader)
        case .quote:
            VStack(alignment: .leading, spacing: 8) { MarkdownBlocksView(blocks: block.children, streaming: streaming) }
                .foregroundStyle(MobileStyle.muted).padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(MobileStyle.border).frame(width: 3) }
        case .list:
            HStack(alignment: .top, spacing: 8) {
                Group {
                    if let checked = block.checked {
                        Image(lucide: checked ? "square-check" : "square", size: 16).padding(.top, 3)
                            .accessibilityLabel(checked ? "Completed" : "Not completed")
                    } else {
                        Text(["-", "*", "+"].contains(block.marker) ? "•" : block.marker).monospacedDigit()
                    }
                }.frame(minWidth: 20, alignment: .trailing)
                VStack(alignment: .leading, spacing: 8) {
                    MarkdownBlocksView(blocks: block.children, streaming: streaming)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .table:
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                    ForEach(Array(block.rows.enumerated()), id: \.offset) { rowIndex, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                ChatInlineText(text: cell, streaming: streaming).font(.subheadline)
                                    .fontWeight(rowIndex == 0 ? .semibold : .regular)
                                    .frame(maxWidth: 260, alignment: .leading).padding(.horizontal, 14).padding(
                                        .vertical, 10)
                            }
                        }
                        if rowIndex < block.rows.count - 1 { Divider().opacity(0.45).gridCellUnsizedAxes(.horizontal) }
                    }
                }.fixedSize(horizontal: false, vertical: true)
                    .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 12))
                    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
            }.fixedSize(horizontal: false, vertical: true).scrollIndicators(.hidden)
        case .rule: Divider()
        case .paragraph:
            if let media = imageReference {
                if let context, let file = ChatFileReference.parse(media.target, cwd: context.cwd, explicit: true),
                    !media.target.hasPrefix("http")
                {
                    ChatInlineImage(
                        resource: .object(["kind": .string("file"), "path": .string(file.path)]), name: media.name)
                    Button(media.name.isEmpty ? "Open image" : media.name) {
                        if let url = ChatFileReference.url(file.path) { openURL(url) }
                    }.font(.caption).frame(minHeight: 44)
                } else if let url = URL(string: media.target), ["http", "https"].contains(url.scheme) {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFit().frame(maxHeight: 320)
                    } placeholder: {
                        ProgressView().frame(height: 80)
                    }
                    .accessibilityLabel(media.name)
                } else {
                    ChatInlineText(text: block.text, streaming: streaming)
                }
            } else {
                ChatInlineText(text: block.text, streaming: streaming)
            }
        }
    }

    private var imageReference: (name: String, target: String)? {
        let text = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.hasPrefix("!["), text.hasSuffix(")"), let middle = text.range(of: "](") else { return nil }
        return (
            String(text[text.index(text.startIndex, offsetBy: 2)..<middle.lowerBound]),
            String(text[middle.upperBound..<text.index(before: text.endIndex)])
        )
    }
}

struct CodeMessage: View {
    let text: String
    var language = ""
    @Environment(\.colorScheme) private var colorScheme
    @State private var colors = CodeHighlightState()
    @State private var wrapsLines = false
    @State private var copied = false
    private var taskID: String { "\(colorScheme == .dark):\(language):\(text)" }
    var body: some View {
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 0) {
                    Text(language.isEmpty ? "Code" : language)
                        .font(.caption.weight(.medium)).foregroundStyle(MobileStyle.muted)
                        .padding(.leading, 14)
                    Spacer()
                    Button {
                        wrapsLines.toggle()
                    } label: {
                        Image(lucide: "corner-down-left")
                            .foregroundStyle(wrapsLines ? MobileStyle.accent : Color.secondary)
                            .frame(width: 44, height: 44)
                    }.accessibilityLabel(wrapsLines ? "Scroll code horizontally" : "Wrap code lines")
                    Button {
                        UIPasteboard.general.string = text
                        copied = true
                    } label: {
                        Image(lucide: copied ? "check" : "copy")
                            .frame(width: 44, height: 44)
                    }.accessibilityLabel(copied ? "Copied" : "Copy code")
                }
                .font(.footnote).buttonStyle(.plain).foregroundStyle(MobileStyle.muted)
                Divider().overlay(MobileStyle.border)
                if wrapsLines {
                    codeText.frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ScrollView(.horizontal) { codeText }
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
            .contextMenu { Button("Copy", lucideIcon: "copy") { UIPasteboard.general.string = text } }
            .task(id: copied) {
                guard copied else { return }
                do { try await Task.sleep(for: .seconds(1.5)) } catch { return }
                copied = false
            }
            .task(id: taskID) { colors.update(text, language: language, dark: colorScheme == .dark) }
            .onDisappear { colors.cancel() }
        }
    }
    private var displayedCode: AttributedString {
        guard let highlighted = colors.highlighted, text.hasPrefix(colors.source) else { return AttributedString(text) }
        return highlighted + AttributedString(String(text.dropFirst(colors.source.count)))
    }

    private var codeText: some View {
        Text(displayedCode).font(.system(.footnote, design: .monospaced))
            .textSelection(.enabled).lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .accessibilityIdentifier(colors.highlighted == nil ? "code.loading" : "code.highlighted")
    }

}

@MainActor @Observable
private final class CodeHighlightState {
    private(set) var highlighted: AttributedString?
    private(set) var source = ""
    @ObservationIgnored private var pending: (text: String, language: String, dark: Bool)?
    @ObservationIgnored private var worker: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    func update(_ text: String, language: String, dark: Bool) {
        pending = (text, language, dark)
        guard worker == nil else { return }
        let current = generation
        worker = Task { [weak self] in
            guard let self else { return }
            while let request = pending {
                pending = nil
                let value = await CodeHighlighter.shared.highlight(
                    request.text, language: request.language, dark: request.dark)
                guard !Task.isCancelled, generation == current else { return }
                highlighted = value
                source = request.text
                do { try await Task.sleep(for: .milliseconds(80)) } catch { return }
            }
            worker = nil
        }
    }

    func cancel() {
        generation += 1
        worker?.cancel()
        worker = nil
        pending = nil
    }
}

actor CodeHighlighter {
    static let shared = CodeHighlighter()
    private var renderer: Highlightr?
    private var currentTheme = ""
    private var cache: [String: AttributedString] = [:]
    private var cacheOrder: [String] = []

    func highlight(_ text: String, language: String, dark: Bool) -> AttributedString? {
        guard !Task.isCancelled else { return nil }
        // Highlightr 2.3 parses descendant CSS selectors as unordered classes; these palettes avoid overlaps.
        let theme = dark ? "tomorrow-night-bright" : "github-gist"
        let key = theme + ":" + language + ":" + text
        if let cached = cache[key] { return cached }
        if renderer == nil { renderer = Highlightr() }
        guard let renderer else { return nil }
        if currentTheme != theme {
            _ = renderer.setTheme(to: theme)
            currentTheme = theme
        }
        guard !Task.isCancelled, let rendered = renderer.highlight(text, as: language.isEmpty ? nil : language),
            var value = try? AttributedString(rendered, including: \.uiKit)
        else { return nil }
        // Run views share storage with the string; copy their attributes before changing it.
        let attributes = value.runs.map {
            (
                range: $0.range, color: $0.uiKit.foregroundColor,
                traits: $0.uiKit.font?.fontDescriptor.symbolicTraits ?? []
            )
        }
        for (range, color, traits) in attributes {
            if let color {
                value[range].swiftUI.foregroundColor = Color(uiColor: color)
            }
            var font = Font.system(.footnote, design: .monospaced)
                .weight(traits.contains(.traitBold) ? .semibold : .regular)
            if traits.contains(.traitItalic) { font = font.italic() }
            value[range].swiftUI.font = font
        }
        guard !Task.isCancelled else { return nil }
        cache[key] = value
        cacheOrder.append(key)
        while cacheOrder.count > 32 { cache.removeValue(forKey: cacheOrder.removeFirst()) }
        return value
    }
}
