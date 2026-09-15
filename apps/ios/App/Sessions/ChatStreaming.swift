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
    var label: String { rawValue.capitalized }
}

struct ChatStreamingMessage: View {
    let text: String
    let streaming: Bool
    @AppStorage("ruimte.chat.streaming") private var mode: ChatStreamingMode = .words
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var source: String
    @State private var characters: [Character]
    @State private var shownCount: Int
    @State private var live: Bool
    @State private var shown: String
    @State private var position: Double
    @State private var sawWriting: Bool
    @State private var initialBlocks: Int

    init(text: String, streaming: Bool) {
        self.text = text
        self.streaming = streaming
        _source = State(initialValue: text)
        _characters = State(initialValue: Array(text))
        _shownCount = State(initialValue: text.count)
        _live = State(initialValue: streaming)
        _sawWriting = State(initialValue: streaming)
        _initialBlocks = State(initialValue: MarkdownSegments.settled(text).count)
        _shown = State(initialValue: text)
        _position = State(initialValue: Double(text.count))
    }

    var body: some View {
        Group {
            if mode == .whole {
                if streaming {
                    ChatLiveLabel(text: "Writing...")
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
                    if streaming { ChatLiveLabel(text: "Writing...") }
                }
            } else if text.isEmpty && streaming {
                ChatLiveLabel(text: "Writing...").font(.body)
            } else {
                MarkdownMessage(text: reduceMotion ? text : shown, streaming: streaming || shown != text)
            }
        }
        .task(id: scenePhase == .active && !reduceMotion && mode == .words && (live || shown != source)) {
            guard !reduceMotion, scenePhase == .active, mode == .words else {
                shown = source
                shownCount = characters.count
                position = Double(characters.count)
                return
            }
            var previous = Date.now
            while !Task.isCancelled {
                if scenePhase != .active { return }
                let now = Date.now
                position = ChatReveal.advance(
                    position, target: characters.count, elapsed: now.timeIntervalSince(previous), finished: !live)
                previous = now
                let next = ChatReveal.boundaryCount(characters, position: Int(position), finished: !live)
                if next > shownCount {
                    shown += String(characters[shownCount..<next])
                    shownCount = next
                }
                if !live && shownCount == characters.count { return }
                do { try await Task.sleep(for: .milliseconds(33)) } catch { return }
            }
        }
        .onChange(of: streaming) { _, value in
            live = value
            if value { sawWriting = true }
        }
        .onChange(of: text) { old, new in
            source = new
            characters = Array(new)
            if reduceMotion || !new.hasPrefix(old) {
                shown = new
                shownCount = characters.count
                position = Double(characters.count)
            }
        }
        .onChange(of: reduceMotion) { _, reduced in
            if reduced {
                shown = text
                shownCount = characters.count
                position = Double(characters.count)
            }
        }
    }
}

private struct ChatWordArrival: TextAttribute {
    let time: TimeInterval
}

private struct ChatWordRenderer: TextRenderer {
    var time: TimeInterval

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            for run in line {
                var context = context
                if let arrival = run[ChatWordArrival.self] {
                    let progress = min(1, max(0, (time - arrival.time) / 0.3))
                    context.opacity = progress * progress * (3 - 2 * progress)
                }
                context.draw(run)
            }
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
        _previousCount = State(
            initialValue: text.characters.reduce(0) { $0 + ($1.isWhitespace ? 1 : 0) }
                + (text.characters.last?.isWhitespace == false ? 1 : 0))
    }

    private var rendered: Text {
        guard !arrivals.isEmpty, !reduceMotion else { return Text(text) }
        var output = Text("")
        var start = text.startIndex
        var word = 0
        for index in text.characters.indices {
            let next = text.characters.index(after: index)
            if text.characters[index].isWhitespace || next == text.endIndex {
                var part = Text(AttributedString(text[start..<next]))
                if let time = arrivals[word] { part = part.customAttribute(ChatWordArrival(time: time)) }
                output = Text("\(output)\(part)")
                start = next
                word += 1
            }
        }
        return output
    }

    var body: some View {
        let content = rendered
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !fading || reduceMotion || scenePhase != .active)) {
            context in
            content.textRenderer(ChatWordRenderer(time: context.date.timeIntervalSinceReferenceDate))
        }
        .task(id: text) {
            let count =
                text.characters.reduce(0) { $0 + ($1.isWhitespace ? 1 : 0) }
                + (text.characters.last?.isWhitespace == false ? 1 : 0)
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
