import SwiftUI
import UIKit

struct ProjectNavigationHost<Root: View, Project: View>: UIViewControllerRepresentable {
    @Binding var isProjectOpen: Bool
    @ViewBuilder let root: () -> Root
    @ViewBuilder let project: () -> Project

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UINavigationController {
        let controller = UINavigationController(rootViewController: context.coordinator.root)
        controller.setNavigationBarHidden(true, animated: false)
        controller.delegate = context.coordinator
        controller.loadViewIfNeeded()
        controller.interactivePopGestureRecognizer?.delegate = context.coordinator
        context.coordinator.navigation = controller
        return controller
    }

    func updateUIViewController(_ controller: UINavigationController, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.root.rootView = root()
        if isProjectOpen { coordinator.project?.rootView = project() }
        coordinator.synchronize()
    }

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIGestureRecognizerDelegate {
        var parent: ProjectNavigationHost
        let root: UIHostingController<Root>
        var project: UIHostingController<Project>?
        weak var navigation: UINavigationController?

        init(_ parent: ProjectNavigationHost) {
            self.parent = parent
            root = UIHostingController(rootView: parent.root())
        }

        func synchronize() {
            guard let navigation, navigation.transitionCoordinator == nil else { return }
            let animated = navigation.view.window != nil && !UIAccessibility.isReduceMotionEnabled
            if parent.isProjectOpen && navigation.viewControllers.count == 1 {
                let screen = UIHostingController(rootView: parent.project())
                project = screen
                navigation.pushViewController(screen, animated: animated)
            } else if !parent.isProjectOpen && navigation.viewControllers.count > 1 {
                navigation.popToRootViewController(animated: animated)
            }
        }

        func navigationController(
            _ navigationController: UINavigationController, didShow viewController: UIViewController, animated: Bool
        ) {
            if viewController === root, project != nil {
                project = nil
                // Only a completed interactive pop closes the workspace; canceled swipes keep its state.
                DispatchQueue.main.async { [weak self] in
                    guard let self, navigation?.viewControllers.count == 1 else { return }
                    parent.isProjectOpen = false
                }
            } else {
                synchronize()
            }
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let navigation, navigation.viewControllers.count > 1,
                navigation.transitionCoordinator == nil, navigation.presentedViewController == nil,
                let project, !hasPushedChild(project)
            else { return false }
            return true
        }

        private func hasPushedChild(_ controller: UIViewController) -> Bool {
            // A view or folder pushed inside a project gets the edge gesture before the outer project stack.
            if let tabs = controller as? UITabBarController {
                return tabs.selectedViewController.map(hasPushedChild) ?? false
            }
            if let navigation = controller as? UINavigationController, navigation.viewControllers.count > 1 {
                return true
            }
            return controller.children.contains { child in
                child.viewIfLoaded?.window != nil && hasPushedChild(child)
            }
        }
    }
}
