import SwiftUI
import UIKit

extension View {
    /// Hides the tab bar while this page is on top of its stack. The bar leaves with the push and comes back with the
    /// pop, following the finger on a swipe back. Goes on the page a stack pushes, outside anything it swaps.
    func hidesTabBarWhenPushed() -> some View {
        background(TabBarHidingAnchor())
    }
}

// Workaround for iOS 27: `.toolbarVisibility(.hidden, for: .tabBar)` drops the bar at once as the push starts and
// brings it back after the pop. UIKit's own flag on the pushed controller moves the bar with the transition.
private struct TabBarHidingAnchor: UIViewRepresentable {
    func makeUIView(context: Context) -> AnchorView { AnchorView() }
    func updateUIView(_ view: AnchorView, context: Context) {}

    final class AnchorView: UIView {
        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
        }

        required init?(coder: NSCoder) { nil }

        // UIKit reads the flag when the push starts, before the controller has a window or a parent, so it is set as
        // soon as the page's view holds this one.
        override func didMoveToSuperview() {
            super.didMoveToSuperview()
            markPage()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            markPage()
        }

        private func markPage() {
            var responder = next
            while let current = responder, !(current is UIViewController) {
                responder = current.next
            }
            guard var page = responder as? UIViewController else { return }
            while let parent = page.parent, !(parent is UINavigationController) {
                page = parent
            }
            page.hidesBottomBarWhenPushed = true
        }
    }
}
