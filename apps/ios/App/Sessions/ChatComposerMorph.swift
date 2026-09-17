import RuimtePulsar
import SwiftUI

struct ChatPromptHeight: Equatable {
    let requestID: String
    let height: CGFloat
}

struct ChatPromptHeightKey: PreferenceKey {
    static let defaultValue: ChatPromptHeight? = nil
    static func reduce(value: inout ChatPromptHeight?, nextValue: () -> ChatPromptHeight?) {
        value = nextValue() ?? value
    }
}

struct ChatComposerActionBounds {
    let anchor: Anchor<CGRect>
    let opacity: Double
    let icon: String
    let title: String?
    let loading: Bool
    let enabled: Bool
    let perform: (() -> Void)?
}

struct ChatComposerActionBoundsKey: PreferenceKey {
    static var defaultValue: [Bool: ChatComposerActionBounds] { [:] }
    static func reduce(value: inout [Bool: ChatComposerActionBounds], nextValue: () -> [Bool: ChatComposerActionBounds])
    {
        value.merge(nextValue(), uniquingKeysWith: { _, next in next })
    }
}

struct ChatComposerAction: ViewModifier {
    let prompt: Bool
    var icon = "arrow-up"
    var title: String?
    var loading = false
    var opacity: Double = 1
    var enabled = true
    var perform: (() -> Void)?
    func body(content: Content) -> some View {
        content.opacity(0).contentShape(Rectangle())
            .anchorPreference(key: ChatComposerActionBoundsKey.self, value: .bounds) {
                [
                    prompt: ChatComposerActionBounds(
                        anchor: $0, opacity: opacity, icon: icon, title: title, loading: loading,
                        enabled: enabled, perform: perform)
                ]
            }
    }
}

struct ChatComposerMorph<Draft: View, Prompt: View>: View {
    let request: JSONValue?
    @ViewBuilder let draft: () -> Draft
    @ViewBuilder let prompt: (JSONValue) -> Prompt
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var retained: JSONValue?
    @State private var draftHeight: CGFloat = 0
    @State private var promptHeight: CGFloat = 0
    @State private var measuredRequestID: String?
    @State private var progress: CGFloat = 0
    @State private var initialized = false
    @State private var transitioning = false
    @State private var transitionID = 0

    init(
        request: JSONValue?,
        @ViewBuilder draft: @escaping () -> Draft, @ViewBuilder prompt: @escaping (JSONValue) -> Prompt
    ) {
        self.request = request
        self.draft = draft
        self.prompt = prompt
        _retained = State(initialValue: request)
    }

    private var shape: ConcentricRectangle { ConcentricRectangle(corners: .concentric(minimum: 24)) }
    private var animation: Animation { .smooth(duration: 0.35) }
    private var target: CGFloat { request == nil ? 0 : 1 }
    private var height: CGFloat { draftHeight + (max(draftHeight, promptHeight) - draftHeight) * progress }

    var body: some View {
        ZStack(alignment: .bottom) {
            // Keep the editor mounted while it fades, so selection and marked text survive the morph.
            draft()
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: { measured in
                    withAnimation(initialized && retained != nil && !reduceMotion ? animation : nil) {
                        draftHeight = measured
                    }
                    if !initialized && (request == nil || promptHeight > 0) { move() }
                }
                .modifier(ComposerContentFade(progress: progress, incoming: false, reduceMotion: reduceMotion))
                .allowsHitTesting(request == nil && !transitioning)
                .accessibilityHidden(request != nil)
            if let retained {
                prompt(retained)
                    .id(retained.text("requestId"))
                    .modifier(ComposerPromptFrame(height: draftHeight > 0 ? height : 0))
                    .modifier(ComposerContentFade(progress: progress, incoming: true, reduceMotion: reduceMotion))
                    .allowsHitTesting(target == 1 && !transitioning)
                    .accessibilityHidden(target != 1)
            }
        }
        .frame(height: draftHeight > 0 ? height : nil, alignment: .bottom)
        // Keep the visible action and its hit target together above the scroll edge effect.
        .overlayPreferenceValue(ChatComposerActionBoundsKey.self) { bounds in
            GeometryReader { geometry in
                if let start = bounds[false] ?? bounds[true], let end = bounds[true] ?? bounds[false] {
                    let source = geometry[start.anchor]
                    let destination = geometry[end.anchor]
                    Button {
                        guard target == 1, !transitioning, end.enabled else { return }
                        end.perform?()
                    } label: {
                        ZStack {
                            Capsule().fill(MobileStyle.accent)
                                .opacity(start.opacity + (end.opacity - start.opacity) * Double(progress))
                            ComposerActionLabel(action: start).fixedSize()
                                .modifier(
                                    ComposerContentFade(progress: progress, incoming: false, reduceMotion: reduceMotion)
                                )
                            ComposerActionLabel(action: end).fixedSize()
                                .modifier(
                                    ComposerContentFade(progress: progress, incoming: true, reduceMotion: reduceMotion)
                                )
                                .opacity(end.opacity)
                        }
                        .foregroundStyle(MobileStyle.onAccent)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(!end.enabled)
                    .allowsHitTesting(target == 1 && !transitioning && end.perform != nil)
                    .accessibilityHidden(target != 1 || transitioning || end.perform == nil)
                    .accessibilityLabel(end.title ?? "Send message")
                    .modifier(ComposerActionFrame(source: source, destination: destination, progress: progress))
                }
            }
        }
        .clipShape(shape)
        .glassEffect(.regular, in: shape)
        .onPreferenceChange(ChatPromptHeightKey.self) { measured in
            guard let measured, measured.requestID == request?.text("requestId"), measured.height > 0 else { return }
            measuredRequestID = measured.requestID
            if promptHeight != measured.height {
                move(toHeight: measured.height)
            } else if progress != target {
                move()
            }
        }
        .onChange(of: request) { _, next in
            if let next {
                retained = next
                // A reversed transition already has a measurement; new content reports its height first.
                if measuredRequestID == next.text("requestId") { move() }
            } else {
                move()
            }
        }
        .onChange(of: reduceMotion) { _, _ in move() }
    }

    private func move(toHeight: CGFloat? = nil) {
        guard draftHeight > 0 else {
            if let toHeight { promptHeight = toHeight }
            return
        }
        let destination = target
        let animate = initialized && !reduceMotion
        if initialized && progress == destination {
            // Resizing a focused prompt must not disable its input or restart its presentation.
            if let toHeight {
                withAnimation(animate ? animation : nil) { promptHeight = toHeight }
            }
            return
        }
        transitionID += 1
        let current = transitionID
        initialized = true
        transitioning = animate
        withAnimation(animate ? animation : nil, completionCriteria: .removed) {
            if let toHeight { promptHeight = toHeight }
            progress = destination
        } completion: {
            guard current == transitionID else { return }
            transitioning = false
            if destination == 0 && request == nil { retained = nil }
        }
    }
}

nonisolated private struct ComposerPromptFrame: AnimatableModifier {
    var height: CGFloat
    var animatableData: CGFloat {
        get { height }
        set { height = newValue }
    }

    func body(content: Content) -> some View {
        // Lay out the scrolling content at each intermediate height, including its first appearance.
        content.frame(height: max(0, height), alignment: .bottom)
    }
}

nonisolated private struct ComposerContentFade: AnimatableModifier {
    var progress: CGFloat
    let incoming: Bool
    let reduceMotion: Bool
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        let visibility = incoming ? progress : 1 - progress
        content
            .opacity(visibility)
            .blur(radius: reduceMotion ? 0 : (1 - visibility) * 6)
    }
}

private struct ComposerActionLabel: View {
    let action: ChatComposerActionBounds

    var body: some View {
        HStack(spacing: 6) {
            if action.loading {
                ProgressView().tint(MobileStyle.onAccent)
            } else {
                Image(lucide: action.icon, size: action.title == nil ? 15 : 16)
            }
            if let title = action.title { Text(title) }
        }
        .font(.subheadline.weight(.semibold))
    }
}

nonisolated private struct ComposerActionFrame: AnimatableModifier {
    var source: CGRect
    var destination: CGRect
    var progress: CGFloat
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        content
            .frame(
                width: source.width + (destination.width - source.width) * progress,
                height: source.height + (destination.height - source.height) * progress
            )
            .clipShape(Capsule())
            .position(
                x: source.midX + (destination.midX - source.midX) * progress,
                y: source.midY + (destination.midY - source.midY) * progress
            )
    }
}
