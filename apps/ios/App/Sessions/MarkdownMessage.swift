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
        let references = MarkdownInline.references(text)
        VStack(alignment: .leading, spacing: 14) {
            if blocks.isEmpty && !text.isEmpty { Text(text).hidden().accessibilityHidden(true) }
            MarkdownBlocksView(blocks: blocks, streaming: streaming)
        }
        .lineSpacing(4).textSelection(.enabled)
        .environment(\.markdownReferences, references.isEmpty ? inheritedReferences : references)
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
        ForEach(Array(MarkdownBlock.grouped(blocks).enumerated()), id: \.offset) { _, group in
            if group.count == 1, let block = group.first {
                MarkdownBlockView(block: block, streaming: streaming)
            } else {
                VStack(alignment: .leading, spacing: MarkdownBlock.itemSpacing) {
                    ForEach(Array(group.enumerated()), id: \.offset) { _, block in
                        MarkdownBlockView(block: block, streaming: streaming)
                    }
                }
            }
        }
    }
}

/// A heading on the desktop's flat scale, against the text of a message: the first level a step larger, the rest
/// the size of the text and only heavier.
enum MarkdownHeading {
    static func font(_ level: Int) -> Font { level == 1 ? .title3.weight(.semibold) : .headline }

    static func style(_ level: Int) -> Font.TextStyle { level == 1 ? .title3 : .body }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    let streaming: Bool
    @Environment(\.chatContent) private var context
    @Environment(\.openURL) private var openURL
    @Environment(\.markdownTableBleed) private var tableBleed

    @ViewBuilder var body: some View {
        switch block.kind {
        case .code(let language):
            if language.lowercased() == "mermaid" {
                MermaidMessage(text: block.text, closed: block.closed)
            } else {
                CodeMessage(text: block.text, language: language, closed: block.closed)
            }
        case .heading(let level):
            ChatInlineText(text: block.text, streaming: streaming)
                .font(MarkdownHeading.font(level)).lineSpacing(2)
                .accessibilityAddTraits(.isHeader)
        case .quote:
            VStack(alignment: .leading, spacing: 8) { MarkdownBlocksView(blocks: block.children, streaming: streaming) }
                .environment(\.markdownTableBleed, 0)
                .environment(\.chatReplySource, nil)
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
                            .foregroundStyle(MobileStyle.faint)
                    }
                }.frame(minWidth: 20, alignment: .trailing)
                VStack(alignment: .leading, spacing: MarkdownBlock.itemSpacing) {
                    MarkdownBlocksView(blocks: block.children, streaming: streaming)
                }
                .environment(\.markdownTableBleed, 0)
                .environment(\.chatReplySource, nil)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .table:
            ScrollView(.horizontal) { MarkdownTable(rows: block.rows, streaming: streaming) }
                .contentMargins(.horizontal, tableBleed, for: .scrollContent)
                .fixedSize(horizontal: false, vertical: true).scrollIndicators(.hidden)
                .padding(.horizontal, -tableBleed)
        case .rule: Divider()
        case .paragraph:
            if let media = imageReference {
                if let context, let file = ChatFileReference.parse(media.target, cwd: context.cwd, explicit: true),
                    !media.target.hasPrefix("http")
                {
                    ChatInlineImage(
                        resource: .object(["kind": .string("file"), "path": .string(file.path)]), name: media.name)
                    Button(media.name.isEmpty ? String(localized: "Open image") : media.name) {
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

struct MarkdownTable: View {
    let rows: [[String]]
    var streaming = false

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                        MarkdownTableCell {
                            ChatInlineText(text: cell, streaming: streaming).font(.footnote)
                                .fontWeight(rowIndex == 0 ? .semibold : .regular)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                    }
                }
                if rowIndex < rows.count - 1 { Divider().opacity(0.45).gridCellUnsizedAxes(.horizontal) }
            }
        }.fixedSize(horizontal: false, vertical: true)
            .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
    }
}

/// A horizontal scroll view proposes no width, so `frame(maxWidth:)` alone measures the text on one line while it
/// wraps when drawn, and the rows overlap. This measures and places the text at the same capped width.
private struct MarkdownTableCell: Layout {
    static let maxWidth: CGFloat = 260

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let text = subviews.first else { return .zero }
        let width = min(text.sizeThatFits(.unspecified).width, Self.maxWidth)
        return CGSize(width: width, height: text.sizeThatFits(ProposedViewSize(width: width, height: nil)).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let text = subviews.first else { return }
        let width = min(text.sizeThatFits(.unspecified).width, Self.maxWidth)
        text.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: width, height: nil))
    }
}

/// Which lines of a code block are numbered and marked.
struct CodeLines: Equatable {
    /// The number of the first line. Without it no line shows a number.
    var start: Int?
    /// The numbers of the lines to mark, counted from `start`, or from 1 without it.
    var marked: Set<Int> = []

    func number(at index: Int) -> Int { (start ?? 1) + index }

    func isMarked(at index: Int) -> Bool { marked.contains(number(at: index)) }

    /// The digits of the last line's number, which every number is as wide as; nil where no line shows one.
    func digits(lines: Int) -> Int? {
        start.map { String($0 + max(0, lines - 1)).count }
    }

    /// The lines of highlighted code, each with its colors and without its line break.
    static func split(_ text: AttributedString) -> [AttributedString] {
        var rows: [AttributedString] = []
        var start = text.startIndex
        for index in text.characters.indices where text.characters[index].isNewline {
            rows.append(AttributedString(text[start..<index]))
            start = text.characters.index(after: index)
        }
        rows.append(AttributedString(text[start...]))
        return rows
    }
}

struct CodeMessage: View {
    let text: String
    var language = ""
    var closed = true
    /// Stands in place of the code, as a diagram does for its source.
    var replacement: AnyView?
    /// Goes before Copy.
    var action: AnyView?
    /// Stands in place of the language, such as the chip of the file the code is from.
    var header: AnyView?
    var lines: CodeLines?
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.chatReplySource) private var replySource
    @State private var colors = CodeHighlightState()
    @State private var wrapsLines = false
    @State private var copied = false
    private var taskID: String { "\(colorScheme == .dark):\(language):\(text)" }
    var body: some View {
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 0) {
                    if let header {
                        header.padding(.leading, 8)
                    } else {
                        Text(language.isEmpty ? String(localized: "Code") : language)
                            .font(.caption.weight(.medium)).foregroundStyle(MobileStyle.muted)
                            .padding(.leading, 14)
                    }
                    Spacer()
                    if ChatShellPrepare.offers(language: language, code: text, closed: closed, source: replySource) {
                        ChatPrepareButton(language: language, code: text)
                    }
                    if replacement == nil {
                        Button {
                            wrapsLines.toggle()
                        } label: {
                            Image(lucide: "corner-down-left")
                                .foregroundStyle(wrapsLines ? MobileStyle.accent : MobileStyle.muted)
                                .frame(width: 44, height: 44)
                        }.accessibilityLabel(wrapsLines ? "Scroll code horizontally" : "Wrap code lines")
                    }
                    if let action { action }
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
                if let replacement {
                    replacement
                } else if let lines, wrapsLines {
                    linedText(lines)
                } else if let lines {
                    // Every line takes the width of the widest, so a mark runs the whole way under a scroll.
                    ScrollView(.horizontal) { linedText(lines).fixedSize(horizontal: true, vertical: false) }
                        .fixedSize(horizontal: false, vertical: true)
                } else if wrapsLines {
                    codeText.frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ScrollView(.horizontal) { codeText }
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
            .contextMenu {
                Button(String(localized: "Copy"), lucideIcon: "copy") { UIPasteboard.general.string = text }
            }
            .task(id: copied) {
                guard copied else { return }
                do { try await Task.sleep(for: .seconds(1.5)) } catch { return }
                copied = false
            }
            .task(id: taskID) { colors.update(text, language: language, dark: colorScheme == .dark) }
            .onDisappear { colors.cancel() }
        }
    }
    private var codeText: some View {
        Text(colors.displayed(text)).font(.system(.footnote, design: .monospaced))
            .textSelection(.enabled).lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .accessibilityIdentifier(colors.highlighted == nil ? "code.loading" : "code.highlighted")
    }

    /// The code a line at a time, each behind its number where the block has one. A marked line has a ground and
    /// a bar of its own, and says so to VoiceOver.
    private func linedText(_ lines: CodeLines) -> some View {
        let rows = CodeLines.split(colors.displayed(text))
        let digits = lines.digits(lines: rows.count)
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                let marked = lines.isMarked(at: index)
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    if let digits {
                        // A number is as wide as the widest one, at any text size.
                        Text(verbatim: String(repeating: "0", count: digits)).hidden()
                            .overlay(alignment: .trailing) {
                                Text(verbatim: "\(lines.number(at: index))").foregroundStyle(MobileStyle.faint)
                            }
                            .accessibilityHidden(true)
                    }
                    Text(row.characters.isEmpty ? AttributedString(" ") : row).textSelection(.enabled)
                        .fixedSize(horizontal: !wrapsLines, vertical: true)
                }
                .padding(.horizontal, 14).padding(.vertical, 1.5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(marked ? MobileStyle.accent.opacity(0.1) : .clear)
                .overlay(alignment: .leading) {
                    if marked { Rectangle().fill(MobileStyle.accent).frame(width: 2) }
                }
                .accessibilityValue(marked ? String(localized: "Highlighted") : "")
            }
        }
        .font(.system(.footnote, design: .monospaced))
        .padding(.vertical, 10)
    }

}

@MainActor @Observable
final class CodeHighlightState {
    private(set) var highlighted: AttributedString?
    private(set) var source = ""
    @ObservationIgnored private var pending: (text: String, language: String, dark: Bool)?
    @ObservationIgnored private var worker: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    /// `text` in the colors of the last highlight that still fits it, so a streaming text keeps its colors.
    func displayed(_ text: String) -> AttributedString {
        guard let highlighted, text.hasPrefix(source) else { return AttributedString(text) }
        return highlighted + AttributedString(String(text.dropFirst(source.count)))
    }

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
