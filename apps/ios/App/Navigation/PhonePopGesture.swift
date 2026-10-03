import UIKit
import os

/// Which swipe back was asked to begin, on which stack, and why it began or not. In Console.app: subsystem
/// `app.ruimte.mobile`, category `navigation-gesture`.
let navigationGestureLog = Logger(subsystem: "app.ruimte.mobile", category: "navigation-gesture")

/// Why a swipe back does not begin.
enum PhoneSwipeRefusal: Equatable, CustomStringConvertible {
    case nothingToPop
    case notTowardTrailingEdge
    /// The content under the finger takes a sideways pan itself; the type of the view that does.
    case contentPans(String)

    var description: String {
        switch self {
        case .nothingToPop: "nothing to pop"
        case .notTowardTrailingEdge: "the pan does not head for the trailing edge"
        case .contentPans(let owner): "\(owner) under the finger pans sideways itself"
        }
    }
}

/// Decides when a stack's swipe back may begin, in place of the delegate UIKit gave the recognizer, which refuses
/// the swipe from anywhere on a page. Every other question still goes to UIKit's delegate, so the swipe keeps
/// yielding to the scroll views under it as the system has it do. Only for a stack with a visible bar: on the stack
/// around the tabs, whose bar is hidden, this left no swipe at all, so that one swipes back through `PhoneSwipeBack`.
@MainActor final class PhonePopGesture: NSObject, UIGestureRecognizerDelegate {
    private weak var container: UIView?
    private let stackName: String
    private let canPop: () -> Bool
    // Read by `responds(to:)` and `forwardingTarget(for:)`, which the runtime calls on the main thread, as it calls
    // every other method of a gesture recognizer's delegate.
    nonisolated(unsafe) private weak var system: (NSObject & UIGestureRecognizerDelegate)?

    /// It begins only for a pan from leading to trailing that no content under the finger answers itself.
    private init(recognizer: UIGestureRecognizer, container: UIView, stackName: String, canPop: @escaping () -> Bool) {
        self.container = container
        self.stackName = stackName
        self.canPop = canPop
        system = recognizer.delegate as? NSObject & UIGestureRecognizerDelegate
        super.init()
        recognizer.delegate = self
    }

    /// The recognizer keeps its delegate weakly, so the stack holds what this returns.
    static func install(
        on recognizer: UIGestureRecognizer?, in container: UIView, stackName: String, canPop: @escaping () -> Bool
    ) -> PhonePopGesture? {
        guard let recognizer else { return nil }
        return PhonePopGesture(recognizer: recognizer, container: container, stackName: stackName, canPop: canPop)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let container else { return false }
        let refusal = Self.refusal(of: gestureRecognizer, in: container, canPop: canPop())
        Self.log(gestureRecognizer, on: stackName, refusal: refusal)
        return refusal == nil
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard let answer = system?.gestureRecognizer?(gestureRecognizer, shouldReceive: touch) else { return true }
        if !answer {
            navigationGestureLog.notice(
                "\(Self.kind(of: gestureRecognizer), privacy: .public) on \(self.stackName, privacy: .public) refused: UIKit's delegate does not let it receive the touch"
            )
        }
        return answer
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer, shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        if let container,
            Self.waitsForRowSwipe(
                gestureRecognizer, otherGestureRecognizer, in: container, edgeWidth: 0, stack: stackName)
        {
            return true
        }
        return system?.gestureRecognizer?(gestureRecognizer, shouldRequireFailureOf: otherGestureRecognizer) ?? false
    }

    /// Never for a row's swipe actions, which wait for nothing of this swipe's.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        if Self.isRowSwipe(otherGestureRecognizer) {
            return false
        }
        return system?.gestureRecognizer?(gestureRecognizer, shouldBeRequiredToFailBy: otherGestureRecognizer) ?? false
    }

    nonisolated override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (system?.responds(to: aSelector) ?? false)
    }

    nonisolated override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let system, system.responds(to: aSelector) { return system }
        return super.forwardingTarget(for: aSelector)
    }

    static func log(_ recognizer: UIGestureRecognizer, on stack: String, refusal: PhoneSwipeRefusal?) {
        let swipe = Self.kind(of: recognizer)
        if let refusal {
            navigationGestureLog.notice(
                "\(swipe, privacy: .public) on \(stack, privacy: .public) refused: \(refusal.description, privacy: .public)"
            )
        } else {
            navigationGestureLog.notice("\(swipe, privacy: .public) on \(stack, privacy: .public) began")
        }
    }

    private static func kind(of recognizer: UIGestureRecognizer) -> String {
        String(describing: type(of: recognizer))
    }

    /// The refusal for a recognizer about to begin, measured from where the finger came down.
    static func refusal(
        of recognizer: UIGestureRecognizer, in container: UIView, canPop: Bool, edgeWidth: CGFloat = 0
    ) -> PhoneSwipeRefusal? {
        let motion = (recognizer as? UIPanGestureRecognizer).map {
            (translation: $0.translation(in: container), velocity: $0.velocity(in: container))
        }
        return refusal(
            canPop: canPop, motion: motion, start: start(of: recognizer, in: container), in: container,
            edgeWidth: edgeWidth)
    }

    private static func start(of recognizer: UIGestureRecognizer, in container: UIView) -> CGPoint {
        let location = recognizer.location(in: container)
        guard let pan = recognizer as? UIPanGestureRecognizer else { return location }
        let translation = pan.translation(in: container)
        return location.applying(.init(translationX: -translation.x, y: -translation.y))
    }

    /// Lets a row's swipe actions go first, so opening them either way and closing an open row win over a swipe back
    /// that starts on the row. A row without actions fails at once and the swipe back goes on.
    static func waitsForRowSwipe(
        _ recognizer: UIGestureRecognizer, _ other: UIGestureRecognizer, in container: UIView, edgeWidth: CGFloat,
        stack: String
    ) -> Bool {
        guard yieldsToRowSwipe(other, start: start(of: recognizer, in: container), in: container, edgeWidth: edgeWidth)
        else {
            return false
        }
        let swipe = Self.kind(of: recognizer)
        let row = Self.kind(of: other)
        // Waiting on each other, neither would ever begin.
        if other.shouldRequireFailure(of: recognizer)
            || other.delegate?.gestureRecognizer?(other, shouldRequireFailureOf: recognizer) == true
        {
            navigationGestureLog.notice(
                "\(swipe, privacy: .public) on \(stack, privacy: .public) does not wait for \(row, privacy: .public), which waits for it"
            )
            return false
        }
        navigationGestureLog.notice(
            "\(swipe, privacy: .public) on \(stack, privacy: .public) waits for \(row, privacy: .public): a row's swipe actions go first"
        )
        return true
    }

    /// Within `edgeWidth` of the leading edge a swipe back goes first, as with the system's edge swipe.
    static func yieldsToRowSwipe(
        _ other: UIGestureRecognizer, start: CGPoint, in container: UIView, edgeWidth: CGFloat
    ) -> Bool {
        guard isRowSwipe(other), let view = other.view, view.isDescendant(of: container) else { return false }
        let rightToLeft = container.effectiveUserInterfaceLayoutDirection == .rightToLeft
        return (rightToLeft ? container.bounds.width - start.x : start.x) > edgeWidth
    }

    /// UIKit's pan behind a list row's swipe actions, which SwiftUI's `.swipeActions` use too. Private, so known by
    /// its name.
    static func isRowSwipe(_ recognizer: UIGestureRecognizer) -> Bool {
        NSStringFromClass(type(of: recognizer)).contains("SwipeAction")
    }

    /// Without `motion` any direction goes. Within `edgeWidth` of the leading edge the content under the finger has
    /// no say, as with the system's edge swipe.
    static func refusal(
        canPop: Bool, motion: (translation: CGPoint, velocity: CGPoint)?, start: CGPoint, in container: UIView,
        edgeWidth: CGFloat = 0
    ) -> PhoneSwipeRefusal? {
        guard canPop else { return .nothingToPop }
        let rightToLeft = container.effectiveUserInterfaceLayoutDirection == .rightToLeft
        if let motion, !pansBack(translation: motion.translation, velocity: motion.velocity, rightToLeft: rightToLeft) {
            return .notTowardTrailingEdge
        }
        let fromLeadingEdge = rightToLeft ? container.bounds.width - start.x : start.x
        guard fromLeadingEdge > edgeWidth,
            let owner = contentPanOwner(at: container.hitTest(start, with: nil), within: container)
        else {
            return nil
        }
        return .contentPans(String(describing: type(of: owner)))
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
    static func contentPanOwner(at touched: UIView?, within container: UIView) -> UIView? {
        var current = touched
        while let view = current, view !== container {
            if let scroll = view as? UIScrollView, scroll.isScrollEnabled, scrollsSideways(scroll) {
                return view
            }
            if !(view.next is UINavigationController),
                view.gestureRecognizers?.contains(where: { isAppPan($0) }) == true
            {
                return view
            }
            if let text = view as? UIView & UITextInput, let selected = text.selectedTextRange, !selected.isEmpty {
                return view
            }
            current = view.superview
        }
        return nil
    }

    private static func scrollsSideways(_ scroll: UIScrollView) -> Bool {
        let insets = scroll.adjustedContentInset
        let width = scroll.contentSize.width + insets.left + insets.right
        return width > scroll.bounds.width + 1 || scroll.maximumZoomScale > scroll.minimumZoomScale
    }

    /// UIKit's own pans (a scroll view's, a list row's swipe actions, a stack's swipe back) and `PhoneSwipeBack`'s
    /// are subclasses.
    private static func isAppPan(_ recognizer: UIGestureRecognizer) -> Bool {
        type(of: recognizer) == UIPanGestureRecognizer.self && recognizer.isEnabled
    }
}
