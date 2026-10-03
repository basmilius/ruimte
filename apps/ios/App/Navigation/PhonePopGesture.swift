import UIKit

/// Decides when a stack's swipe back may begin, in place of the delegate UIKit gave the recognizer, which refuses
/// both swipes while the stack's bar is hidden. Every other question still goes to UIKit's delegate, so the swipe
/// keeps yielding to the scroll views under it as the system has it do.
@MainActor final class PhonePopGesture: NSObject, UIGestureRecognizerDelegate {
    private weak var container: UIView?
    private let canPop: () -> Bool
    private let guardsContent: Bool
    // Read by `responds(to:)` and `forwardingTarget(for:)`, which the runtime calls on the main thread, as it calls
    // every other method of a gesture recognizer's delegate.
    nonisolated(unsafe) private weak var system: NSObject?

    /// With `guardsContent`, for a swipe that may start anywhere: it begins only for a pan from leading to trailing
    /// that no content under the finger answers itself.
    private init(recognizer: UIGestureRecognizer, container: UIView, guardsContent: Bool, canPop: @escaping () -> Bool) {
        self.container = container
        self.canPop = canPop
        self.guardsContent = guardsContent
        system = recognizer.delegate as? NSObject
        super.init()
        recognizer.delegate = self
    }

    /// The recognizer keeps its delegate weakly, so the stack holds what this returns.
    static func install(
        on recognizer: UIGestureRecognizer?, in container: UIView, guardsContent: Bool, canPop: @escaping () -> Bool
    ) -> PhonePopGesture? {
        guard let recognizer else { return nil }
        return PhonePopGesture(recognizer: recognizer, container: container, guardsContent: guardsContent, canPop: canPop)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard canPop() else { return false }
        guard guardsContent, let container else { return true }
        guard let pan = gestureRecognizer as? UIPanGestureRecognizer else {
            let location = gestureRecognizer.location(in: container)
            return !Self.contentOwnsPan(at: container.hitTest(location, with: nil), within: container)
        }
        let translation = pan.translation(in: container)
        let start = pan.location(in: container).applying(.init(translationX: -translation.x, y: -translation.y))
        return Self.pansBack(
            translation: translation, velocity: pan.velocity(in: container),
            rightToLeft: container.effectiveUserInterfaceLayoutDirection == .rightToLeft)
            && !Self.contentOwnsPan(at: container.hitTest(start, with: nil), within: container)
    }

    nonisolated override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (system?.responds(to: aSelector) ?? false)
    }

    nonisolated override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let system, system.responds(to: aSelector) { return system }
        return super.forwardingTarget(for: aSelector)
    }

    /// A pan that leaves more toward the trailing edge than up or down, as a swipe back in the system's apps does.
    nonisolated static func pansBack(translation: CGPoint, velocity: CGPoint, rightToLeft: Bool) -> Bool {
        let motion = translation == .zero ? velocity : translation
        let forward = rightToLeft ? -motion.x : motion.x
        return forward > 0 && forward > abs(motion.y)
    }

    /// Content between the touched view and the stack that takes a horizontal pan for itself: a scroll view that
    /// scrolls sideways or zooms (a canvas, a drawing, a document scene, a wide code line, a terminal grid wider than
    /// the screen, a web page), a pan the app added (a terminal's selection), and text with a selection whose handles
    /// a finger drags.
    static func contentOwnsPan(at touched: UIView?, within container: UIView) -> Bool {
        var current = touched
        while let view = current, view !== container {
            if let scroll = view as? UIScrollView, scroll.isScrollEnabled, scrollsSideways(scroll) {
                return true
            }
            if !(view.next is UINavigationController),
                view.gestureRecognizers?.contains(where: { isAppPan($0) }) == true
            {
                return true
            }
            if let text = view as? UIView & UITextInput, let selected = text.selectedTextRange, !selected.isEmpty {
                return true
            }
            current = view.superview
        }
        return false
    }

    private static func scrollsSideways(_ scroll: UIScrollView) -> Bool {
        let insets = scroll.adjustedContentInset
        let width = scroll.contentSize.width + insets.left + insets.right
        return width > scroll.bounds.width + 1 || scroll.maximumZoomScale > scroll.minimumZoomScale
    }

    /// UIKit's own pans (a scroll view's, a list row's swipe actions, a stack's swipe back) are subclasses.
    private static func isAppPan(_ recognizer: UIGestureRecognizer) -> Bool {
        type(of: recognizer) == UIPanGestureRecognizer.self && recognizer.isEnabled
    }
}
