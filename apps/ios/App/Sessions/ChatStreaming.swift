import SwiftUI

enum ChatReveal {
    static func advance(_ position: Double, target: Int, elapsed: Double, finished: Bool) -> Double {
        let elapsed = min(0.1, max(0, elapsed))
        let gap = max(0, Double(target) - position)
        return min(Double(target), position + max(gap * (1 - exp(-elapsed / 0.25)), elapsed * (finished ? 120 : 40)))
    }

    static func boundary(_ text: String, position: Int, finished: Bool) -> String {
        let characters = Array(text)
        return String(characters.prefix(boundaryCount(characters, position: position, finished: finished)))
    }

    static func boundaryCount(_ characters: [Character], position: Int, finished: Bool) -> Int {
        let end = min(characters.count, max(0, position))
        if finished && end == characters.count { return end }
        var cut = end
        while cut > 0 && cut < characters.count && !characters[cut].isWhitespace && !characters[cut - 1].isWhitespace {
            cut -= 1
        }
        if cut == characters.count && cut > 0 && !characters[cut - 1].isWhitespace {
            while cut > 0 && !characters[cut - 1].isWhitespace { cut -= 1 }
        }
        return end - cut > 32 ? end : cut
    }
}

enum ChatStreamingMode: String, CaseIterable {
    case words, blocks, whole
    /// The desktop's words under Settings, Chats, Show replies.
    var label: String {
        switch self {
        case .words: String(localized: "Word by word")
        case .blocks: String(localized: "Paragraph by paragraph")
        case .whole: String(localized: "When complete")
        }
    }
}

struct ChatStreamingMessage: View {
    let text: String
    let streaming: Bool
    @AppStorage("ruimte.chat.streaming") private var mode: ChatStreamingMode = .words
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var source: String
    @State private var reveal: ChatWordReveal?
    @State private var live: Bool
    @State private var sawWriting: Bool
    @State private var initialBlocks: Int

    init(text: String, streaming: Bool) {
        self.text = text
        self.streaming = streaming
        _source = State(initialValue: text)
        _live = State(initialValue: streaming)
        _sawWriting = State(initialValue: streaming)
        _initialBlocks = State(initialValue: MarkdownSegments.settled(text).count)
    }

    private var shown: String { reveal?.shown ?? source }

    var body: some View {
        Group {
            if mode == .whole {
                if streaming {
                    ChatLiveLabel(text: String(localized: "Writing…"))
                } else {
                    MarkdownMessage(text: text).modifier(ChatBlockArrival(enabled: sawWriting))
                }
            } else if mode == .blocks {
                let chunks = streaming ? MarkdownSegments.settled(text) : MarkdownSegments.split(text)
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(chunks.enumerated()), id: \.offset) { index, chunk in
                        MarkdownMessage(text: chunk).modifier(
                            ChatBlockArrival(enabled: sawWriting && index >= initialBlocks))
                    }
                    if streaming { ChatLiveLabel(text: String(localized: "Writing…")) }
                }
            } else if text.isEmpty && streaming {
                ChatLiveLabel(text: String(localized: "Writing…")).font(.body)
            } else {
                MarkdownMessage(text: reduceMotion ? text : shown, streaming: streaming || shown != text)
            }
        }
        .task(id: scenePhase == .active && !reduceMotion && mode == .words && (live || shown != source)) {
            guard !reduceMotion, scenePhase == .active, mode == .words else {
                showWhole()
                return
            }
            if !live && shown == source { return }
            if reveal == nil { reveal = ChatWordReveal(source) }
            var previous = Date.now
            while !Task.isCancelled {
                if scenePhase != .active { return }
                let now = Date.now
                reveal?.advance(elapsed: now.timeIntervalSince(previous), finished: !live)
                previous = now
                if !live, let reveal, reveal.shownCount == reveal.characters.count { return }
                do { try await Task.sleep(for: .milliseconds(33)) } catch { return }
            }
        }
        .onChange(of: streaming) { _, value in
            live = value
            if value { sawWriting = true }
        }
        .onChange(of: text) { _, new in
            if reduceMotion || mode != .words {
                source = new
                showWhole()
                return
            }
            if reveal == nil { reveal = ChatWordReveal(source) }
            reveal?.update(new)
            source = new
        }
        .onChange(of: reduceMotion) { _, reduced in
            if reduced { showWhole() }
        }
    }

    private func showWhole() {
        reveal = nil
    }
}

private struct ChatWordArrival: TextAttribute {
    let time: TimeInterval
}

private struct ChatPillMark: TextAttribute {
    let pill: ChatPill
}

/// Fades each arriving word in, and draws the ground of each pill behind its text.
private struct ChatWordRenderer: TextRenderer {
    var time: TimeInterval

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            var pill: (pill: ChatPill, rect: CGRect, opacity: Double)?
            for run in line {
                let mark = run[ChatPillMark.self]?.pill
                if let current = pill, current.pill != mark {
                    fill(current.pill, current.rect, opacity: current.opacity, in: context)
                    pill = nil
                }
                if let mark {
                    let rect = run.typographicBounds.rect
                    pill = (mark, pill?.rect.union(rect) ?? rect, min(pill?.opacity ?? 1, opacity(run)))
                }
            }
            if let pill { fill(pill.pill, pill.rect, opacity: pill.opacity, in: context) }
            for run in line {
                var context = context
                context.opacity = opacity(run)
                if run[ChatPillMark.self]?.pill.isReference == true {
                    // A link takes the tint whatever color it carries, so a reference draws as a mask in the text's.
                    context.clipToLayer { layer in layer.draw(run) }
                    context.fill(
                        Path(run.typographicBounds.rect.insetBy(dx: -4, dy: -4)), with: .color(MobileStyle.text))
                } else {
                    context.draw(run)
                }
            }
        }
    }

    private func opacity(_ run: Text.Layout.Run) -> Double {
        guard let arrival = run[ChatWordArrival.self] else { return 1 }
        let progress = min(1, max(0, (time - arrival.time) / 0.3))
        return progress * progress * (3 - 2 * progress)
    }

    private func fill(_ pill: ChatPill, _ rect: CGRect, opacity: Double, in context: GraphicsContext) {
        var context = context
        context.opacity = opacity
        if pill.kind == .code {
            let shape = RoundedRectangle(cornerRadius: 4).path(in: rect.insetBy(dx: 0, dy: -1))
            context.fill(shape, with: .color(MobileStyle.inset))
        } else if pill.isReference {
            let shape = RoundedRectangle(cornerRadius: 6).path(in: rect.insetBy(dx: 0, dy: -2))
            context.fill(shape, with: .color(MobileStyle.text.opacity(0.08)))
            context.stroke(shape, with: .color(MobileStyle.text.opacity(0.16)), lineWidth: 1)
        } else {
            let shape = RoundedRectangle(cornerRadius: 6).path(in: rect.insetBy(dx: 0, dy: -2))
            context.fill(shape, with: .color(pill.tint.opacity(0.12)))
            context.stroke(shape, with: .color(pill.tint.opacity(0.25)), lineWidth: 1)
        }
    }
}

struct ChatFadingText: View {
    let text: AttributedString
    let streaming: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var arrivals: [Int: TimeInterval] = [:]
    @State private var previousCount = 0
    @State private var fading = false

    init(text: AttributedString, streaming: Bool) {
        self.text = text
        self.streaming = streaming
        _previousCount = State(initialValue: Self.wordCount(text))
    }

    /// The words of `text`, the last one counted while it is still being written.
    private static func wordCount(_ text: AttributedString) -> Int {
        text.characters.count(where: \.isWhitespace) + (text.characters.last?.isWhitespace == false ? 1 : 0)
    }

    private var rendered: Text {
        let fades = !arrivals.isEmpty && !reduceMotion
        let runs = text.runs[ChatPillAttribute.self]
        guard fades || runs.contains(where: { $0.0 != nil }) else { return Text(text) }
        var output = Text(verbatim: "")
        var word = 0
        for (pill, range) in runs {
            let sigil = pill?.icon == nil ? nil : text.characters.index(after: range.lowerBound)
            guard fades else {
                output = Text("\(output)\(piece(range, pill: pill, sigil: sigil, arrival: nil))")
                continue
            }
            var start = range.lowerBound
            var index = start
            while index < range.upperBound {
                let next = text.characters.index(after: index)
                let ends = text.characters[index].isWhitespace || next == text.endIndex
                if ends || next == range.upperBound {
                    output = Text("\(output)\(piece(start..<next, pill: pill, sigil: sigil, arrival: arrivals[word]))")
                    start = next
                }
                if ends { word += 1 }
                index = next
            }
        }
        return output
    }

    /// A part of the text, with the mark of a picked file or skill in place of its sigil.
    private func piece(
        _ range: Range<AttributedString.Index>, pill: ChatPill?, sigil: AttributedString.Index?,
        arrival: TimeInterval?
    ) -> Text {
        var part: Text
        if let pill, let icon = pill.icon, let sigil, range.contains(sigil) {
            let after = text.characters.index(after: sigil)
            let gap = AttributedString(
                String(ChatInlineMarks.padding), attributes: text[sigil..<after].runs.first?.attributes ?? .init())
            let before = Text(AttributedString(text[range.lowerBound..<sigil]))
            let mark = Text(Image(lucide: icon, size: 12)).foregroundStyle(pill.tint).baselineOffset(-1.5)
            let name = Text(AttributedString(text[after..<range.upperBound]))
            part = Text("\(before)\(mark)\(Text(gap))\(name)")
        } else {
            part = Text(AttributedString(text[range]))
        }
        if let pill { part = part.customAttribute(ChatPillMark(pill: pill)) }
        if let arrival { part = part.customAttribute(ChatWordArrival(time: arrival)) }
        return part
    }

    var body: some View {
        let content = rendered
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !fading || reduceMotion || scenePhase != .active)) {
            context in
            content.textRenderer(ChatWordRenderer(time: context.date.timeIntervalSinceReferenceDate))
        }
        .task(id: text) {
            let count = Self.wordCount(text)
            if streaming && !reduceMotion {
                let now = Date.now.timeIntervalSinceReferenceDate
                if count < previousCount { arrivals = [:] }
                for word in min(previousCount, count)..<count { arrivals[word] = now }
                arrivals = arrivals.filter { now - $0.value < 0.35 }
                fading = !arrivals.isEmpty
            }
            previousCount = count
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            fading = false
            arrivals = [:]
        }
    }
}

struct ChatBlockArrival: ViewModifier {
    let enabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var began = Date.now
    @State private var finished = false

    func body(content: Content) -> some View {
        TimelineView(
            .animation(minimumInterval: 1.0 / 30, paused: !enabled || finished || reduceMotion || scenePhase != .active)
        ) { context in
            content.opacity(
                !enabled || reduceMotion || finished ? 1 : min(1, max(0, context.date.timeIntervalSince(began) / 0.3)))
        }
        .task {
            guard enabled, !reduceMotion else {
                finished = true
                return
            }
            began = .now
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            finished = true
        }
    }
}
