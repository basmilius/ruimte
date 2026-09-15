import Foundation
@preconcurrency import Highlightr
import SwiftUI
import UIKit

struct MarkdownBlock: Sendable, Equatable {
    enum Kind: Sendable, Equatable {
        case paragraph
        case heading(Int)
        case code(String)
        case quote, list, table
    }
    let kind: Kind
    let text: String
    var rows: [[String]] = []

    static func parse(_ markdown: String) -> [MarkdownBlock] {
        let lines = markdown.components(separatedBy: "\n")
        var result: [MarkdownBlock] = []
        var index = 0
        var paragraph: [String] = []
        func flush() {
            if !paragraph.isEmpty {
                result.append(MarkdownBlock(kind: .paragraph, text: paragraph.joined(separator: "\n")))
                paragraph.removeAll()
            }
        }
        func cells(_ line: String) -> [String] {
            var values = line.split(separator: "|", omittingEmptySubsequences: false).map {
                $0.trimmingCharacters(in: .whitespaces)
            }
            if values.first == "" { values.removeFirst() }
            if values.last == "" { values.removeLast() }
            return values
        }
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flush()
                let marker = String(trimmed.prefix(3))
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                index += 1
                var code: [String] = []
                while index < lines.count && !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(marker) {
                    code.append(lines[index])
                    index += 1
                }
                result.append(MarkdownBlock(kind: .code(language), text: code.joined(separator: "\n")))
            } else if line.contains("|"), index + 1 < lines.count,
                cells(lines[index + 1]).allSatisfy({ !$0.isEmpty && $0.allSatisfy { "-: ".contains($0) } }),
                lines[index + 1].contains("-")
            {
                flush()
                var rows = [cells(line)]
                index += 2
                while index < lines.count && lines[index].contains("|") && !lines[index].isEmpty {
                    rows.append(cells(lines[index]))
                    index += 1
                }
                index -= 1
                result.append(MarkdownBlock(kind: .table, text: "", rows: rows))
            } else if trimmed.isEmpty {
                flush()
            } else if trimmed.hasPrefix("#"), let space = trimmed.firstIndex(of: " "),
                trimmed[..<space].allSatisfy({ $0 == "#" })
            {
                flush()
                result.append(
                    MarkdownBlock(
                        kind: .heading(min(6, trimmed.distance(from: trimmed.startIndex, to: space))),
                        text: String(trimmed[trimmed.index(after: space)...])))
            } else if trimmed.hasPrefix("> ") {
                flush()
                result.append(MarkdownBlock(kind: .quote, text: String(trimmed.dropFirst(2))))
            } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ")
                || trimmed.range(of: #"^\d+\. "#, options: .regularExpression) != nil
            {
                flush()
                result.append(MarkdownBlock(kind: .list, text: line))
            } else {
                paragraph.append(line)
            }
            index += 1
        }
        flush()
        return result
    }
}

struct MarkdownMessage: View {
    let text: String
    @State private var blocks: [MarkdownBlock] = []
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if blocks.isEmpty { Text(text).textSelection(.enabled) }
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block.kind {
                case .code(let language): CodeMessage(text: block.text, language: language)
                case .heading(let level):
                    inline(block.text).font(level == 1 ? .title2.bold() : level == 2 ? .title3.bold() : .headline)
                        .accessibilityAddTraits(.isHeader)
                case .quote:
                    HStack {
                        RoundedRectangle(cornerRadius: 2).fill(.tertiary).frame(width: 3)
                        inline(block.text).foregroundStyle(MobileStyle.muted)
                    }
                case .table:
                    ScrollView(.horizontal) {
                        Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                            ForEach(Array(block.rows.enumerated()), id: \.offset) { rowIndex, row in
                                GridRow {
                                    ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                        inline(cell).font(.subheadline)
                                            .fontWeight(rowIndex == 0 ? .semibold : .regular)
                                            .frame(maxWidth: 260, alignment: .leading)
                                            .padding(.horizontal, 14).padding(.vertical, 10)
                                    }
                                }
                                if rowIndex < block.rows.count - 1 {
                                    Divider().opacity(0.45).gridCellUnsizedAxes(.horizontal)
                                }
                            }
                        }.fixedSize(horizontal: false, vertical: true)
                            .background(
                                MobileStyle.panel, in: RoundedRectangle(cornerRadius: 12)
                            )
                            .overlay {
                                RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border)
                            }
                    }.fixedSize(horizontal: false, vertical: true)
                        .scrollIndicators(.hidden)
                default: inline(block.text)
                }
            }
        }
        .lineSpacing(4)
        .textSelection(.enabled)
        .task(id: text) {
            let source = text
            let parsed = await Task.detached(priority: .userInitiated) { MarkdownBlock.parse(source) }.value
            guard !Task.isCancelled else { return }
            blocks = parsed
        }
    }

    private func inline(_ text: String) -> Text {
        var attributed =
            (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
        let codeRanges = attributed.runs.compactMap { run in
            run.inlinePresentationIntent?.contains(.code) == true ? run.range : nil
        }
        for range in codeRanges {
            attributed[range].swiftUI.font = .system(.body, design: .monospaced)
            attributed[range].swiftUI.backgroundColor = MobileStyle.panel
        }
        return Text(attributed)
    }

}

struct CodeMessage: View {
    let text: String
    var language = ""
    @Environment(\.colorScheme) private var colorScheme
    @State private var highlighted: AttributedString?
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
            .task(id: taskID) {
                highlighted = nil
                do { try await Task.sleep(for: .milliseconds(80)) } catch { return }
                let value = await CodeHighlighter.shared.highlight(text, language: language, dark: colorScheme == .dark)
                guard !Task.isCancelled else { return }
                highlighted = value
            }
        }
    }
    private var codeText: some View {
        Text(highlighted ?? AttributedString(text)).font(.system(.footnote, design: .monospaced))
            .textSelection(.enabled).lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .accessibilityIdentifier(highlighted == nil ? "code.loading" : "code.highlighted")
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
