import SwiftUI
import UIKit

struct ProjectSplitView<Sidebar: View, Detail: View>: UIViewControllerRepresentable {
    @Binding var sidebarVisible: Bool
    @ViewBuilder let sidebar: () -> Sidebar
    @ViewBuilder let detail: () -> Detail

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UISplitViewController {
        let controller = UISplitViewController(style: .doubleColumn)
        controller.preferredSplitBehavior = .tile
        controller.preferredDisplayMode = sidebarVisible ? .oneBesideSecondary : .secondaryOnly
        controller.minimumPrimaryColumnWidth = 320
        controller.maximumPrimaryColumnWidth = 420
        controller.preferredPrimaryColumnWidth = 360
        controller.presentsWithGesture = true
        controller.displayModeButtonVisibility = .never
        controller.showsSecondaryOnlyButton = false
        controller.delegate = context.coordinator
        context.coordinator.sidebar.traitOverrides.horizontalSizeClass = .compact
        context.coordinator.sidebar.view.backgroundColor = .systemBackground
        context.coordinator.detail.view.backgroundColor = .systemBackground
        controller.setViewController(context.coordinator.primaryNavigation, for: .primary)
        controller.setViewController(context.coordinator.secondaryNavigation, for: .secondary)
        return controller
    }

    func updateUIViewController(_ controller: UISplitViewController, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.sidebar.rootView = sidebar()
        coordinator.detail.rootView = detail()
        guard coordinator.requestedVisibility != sidebarVisible else { return }
        coordinator.requestedVisibility = sidebarVisible
        let update = {
            if sidebarVisible { controller.show(.primary) } else { controller.hide(.primary) }
        }
        if UIAccessibility.isReduceMotionEnabled { UIView.performWithoutAnimation(update) } else { update() }
    }

    final class Coordinator: NSObject, UISplitViewControllerDelegate {
        var parent: ProjectSplitView
        var requestedVisibility: Bool
        let sidebar: UIHostingController<Sidebar>
        let detail: UIHostingController<Detail>
        let primaryNavigation: UINavigationController
        let secondaryNavigation: UINavigationController

        init(_ parent: ProjectSplitView) {
            self.parent = parent
            requestedVisibility = parent.sidebarVisible
            sidebar = UIHostingController(rootView: parent.sidebar())
            detail = UIHostingController(rootView: parent.detail())
            // Split columns otherwise gain an extra UIKit navigation bar above SwiftUI's own bar.
            primaryNavigation = UINavigationController(rootViewController: sidebar)
            secondaryNavigation = UINavigationController(rootViewController: detail)
            primaryNavigation.setNavigationBarHidden(true, animated: false)
            secondaryNavigation.setNavigationBarHidden(true, animated: false)
        }

        func splitViewController(
            _ controller: UISplitViewController, willChangeTo displayMode: UISplitViewController.DisplayMode
        ) {
            let visible = displayMode != .secondaryOnly
            requestedVisibility = visible
            DispatchQueue.main.async { [weak self] in
                guard let self, requestedVisibility == visible, parent.sidebarVisible != visible else { return }
                parent.sidebarVisible = visible
            }
        }
    }
}
