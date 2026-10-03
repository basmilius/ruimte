import UIKit

/// The swipe back of the stack around the tabs, from the edge or from anywhere on a view. UIKit's own recognizers
/// stay off there: with the stack's bar hidden, which it always is, their delegate turns them off, and answering
/// `gestureRecognizerShouldBegin` in its place while it answers the rest left no swipe at all. So this pan drives the
/// pop itself.
@MainActor final class PhoneSwipeBack: NSObject, UIGestureRecognizerDelegate {
    /// From this close to the leading edge a swipe goes back over content that pans sideways too.
    static let edgeWidth: CGFloat = 24

    let recognizer = PhoneSwipeBackRecognizer()
    private weak var stack: UINavigationController?
    private let stackName: String
    private let canPop: () -> Bool
    private var interaction: UIPercentDrivenInteractiveTransition?

    init(stack: UINavigationController, stackName: String, canPop: @escaping () -> Bool) {
        self.stack = stack
        self.stackName = stackName
        self.canPop = canPop
        super.init()
        recognizer.delegate = self
        recognizer.addTarget(self, action: #selector(pan(_:)))
        stack.view.addGestureRecognizer(recognizer)
    }

    /// The animator for the pop this swipe started, and nil for every other push or pop, which keep UIKit's own.
    func animator(for operation: UINavigationController.Operation) -> (any UIViewControllerAnimatedTransitioning)? {
        guard operation == .pop, interaction != nil, let stack else { return nil }
        return PhoneSwipeBackAnimator(rightToLeft: stack.view.effectiveUserInterfaceLayoutDirection == .rightToLeft)
    }

    func interactionController(
        for animator: any UIViewControllerAnimatedTransitioning
    ) -> (any UIViewControllerInteractiveTransitioning)? {
        animator is PhoneSwipeBackAnimator ? interaction : nil
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let stack else { return false }
        let refusal = PhonePopGesture.refusal(
            of: gestureRecognizer, in: stack.view, canPop: canPop(), edgeWidth: Self.edgeWidth)
        PhonePopGesture.log(gestureRecognizer, on: stackName, refusal: refusal)
        return refusal == nil
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer, shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        guard let stack else { return false }
        return PhonePopGesture.waitsForRowSwipe(
            gestureRecognizer, otherGestureRecognizer, in: stack.view, edgeWidth: Self.edgeWidth, stack: stackName)
    }

    /// A scroll view in the view waits for the swipe to fail, so a sideways pan over a list goes back instead of
    /// nudging the list, as it does under UIKit's own swipe.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        guard canPop(), let stack, let scroll = otherGestureRecognizer.view as? UIScrollView else { return false }
        return otherGestureRecognizer === scroll.panGestureRecognizer && scroll.isDescendant(of: stack.view)
    }

    @objc private func pan(_ recognizer: PhoneSwipeBackRecognizer) {
        guard let stack else { return }
        let width = max(stack.view.bounds.width, 1)
        let forward: CGFloat = stack.view.effectiveUserInterfaceLayoutDirection == .rightToLeft ? -1 : 1
        let progress = min(max(recognizer.translation(in: stack.view).x * forward / width, 0), 1)
        switch recognizer.state {
        case .began:
            interaction = UIPercentDrivenInteractiveTransition()
            if stack.popViewController(animated: true) == nil {
                interaction = nil
                navigationGestureLog.notice("PhoneSwipeBack on \(self.stackName, privacy: .public) popped nothing")
            }
        case .changed:
            interaction?.update(progress)
        case .ended, .cancelled, .failed:
            guard let interaction else { return }
            let velocity = recognizer.velocity(in: stack.view).x * forward
            let finishes = recognizer.state == .ended && (velocity > 300 || (progress > 0.5 && velocity > -300))
            if finishes {
                interaction.finish()
            } else {
                interaction.cancel()
            }
            self.interaction = nil
            navigationGestureLog.notice(
                "PhoneSwipeBack on \(self.stackName, privacy: .public) \(finishes ? "went back" : "cancelled", privacy: .public) at \(Int(progress * 100))%"
            )
        default:
            break
        }
    }
}

/// Its own type, so `PhonePopGesture.contentPanOwner` never takes it for a pan of the content.
final class PhoneSwipeBackRecognizer: UIPanGestureRecognizer {}

/// The pop the swipe drives: the view leaves toward the trailing edge while what is under it slides back in from a
/// third of the way, as in UIKit's own pop.
@MainActor final class PhoneSwipeBackAnimator: NSObject, UIViewControllerAnimatedTransitioning {
    private let rightToLeft: Bool
    private var animator: UIViewPropertyAnimator?

    init(rightToLeft: Bool) {
        self.rightToLeft = rightToLeft
    }

    func transitionDuration(using transitionContext: (any UIViewControllerContextTransitioning)?) -> TimeInterval {
        0.35
    }

    func animateTransition(using transitionContext: any UIViewControllerContextTransitioning) {
        interruptibleAnimator(using: transitionContext).startAnimation()
    }

    func interruptibleAnimator(
        using transitionContext: any UIViewControllerContextTransitioning
    ) -> any UIViewImplicitlyAnimating {
        if let animator {
            return animator
        }
        let container = transitionContext.containerView
        let from = transitionContext.view(forKey: .from)
        let to = transitionContext.view(forKey: .to)
        if let to, let toController = transitionContext.viewController(forKey: .to) {
            to.frame = transitionContext.finalFrame(for: toController)
            container.insertSubview(to, at: 0)
        }
        let trailing: CGFloat = rightToLeft ? -container.bounds.width : container.bounds.width
        to?.transform = CGAffineTransform(translationX: -trailing / 3, y: 0)
        let animator = UIViewPropertyAnimator(duration: transitionDuration(using: transitionContext), curve: .linear) {
            from?.transform = CGAffineTransform(translationX: trailing, y: 0)
            to?.transform = .identity
        }
        animator.addCompletion { _ in
            from?.transform = .identity
            to?.transform = .identity
            transitionContext.completeTransition(!transitionContext.transitionWasCancelled)
        }
        self.animator = animator
        return animator
    }
}
