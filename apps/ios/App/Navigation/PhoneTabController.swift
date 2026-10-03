import SwiftUI
import UIKit

/// A SwiftUI page on a tab's stack. A route's page carries `hidesBottomBarWhenPushed` from its creation, since UIKit
/// reads the flag when the push starts and only then moves the tab bar with the transition and the finger.
final class PhonePageController: UIHostingController<AnyView> {
    /// Nil for a tab's root.
    let route: PhoneRoute?

    init(route: PhoneRoute?, page: AnyView) {
        self.route = route
        super.init(rootView: page)
        hidesBottomBarWhenPushed = route?.hidesTabBar ?? false
    }

    required init?(coder aDecoder: NSCoder) {
        nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MobileStyle.surfaceColor
    }
}

/// One tab's stack, which pushes and pops to match the tab's path in `PhoneRouter`.
final class PhoneStackController: UINavigationController, UINavigationControllerDelegate {
    let phoneTab: PhoneTab
    /// Builds the page of a route.
    var makePage: (PhoneRoute) -> PhonePageController = { PhonePageController(route: $0, page: AnyView(EmptyView())) }
    /// Tells the router this tab is the one on screen, however it got selected.
    var appeared: (PhoneTab) -> Void = { _ in }
    /// Hands the routes this stack holds to the router once a push or a pop settled.
    var settled: (PhoneTab, [PhoneRoute]) -> Void = { _, _ in }
    /// The last path the router asked for. The router repeats it on every update, and repeating it while a swipe
    /// back runs must not push the page back once the swipe lands.
    private var requested: [PhoneRoute] = []
    /// A path asked for during a transition, shown once the transition ends.
    private var pending: [PhoneRoute]?

    init(tab: PhoneTab, root: PhonePageController) {
        self.phoneTab = tab
        super.init(rootViewController: root)
        delegate = self
        navigationBar.prefersLargeTitles = true
    }

    required init?(coder aDecoder: NSCoder) {
        nil
    }

    /// The routes on the stack. A page SwiftUI pushes from inside a page has none and keeps the route under it.
    var routes: [PhoneRoute] {
        viewControllers.compactMap { ($0 as? PhonePageController)?.route }
    }

    func show(_ path: [PhoneRoute], animated: Bool) {
        guard path != requested else { return }
        requested = path
        pending = path
        showPending(animated: animated)
    }

    private func showPending(animated: Bool) {
        guard let path = pending else { return }
        if let coordinator = transitionCoordinator {
            coordinator.animate(alongsideTransition: nil) { [weak self] _ in
                // The stack takes its final controllers only after the transition's completion returns.
                DispatchQueue.main.async { self?.showPending(animated: self?.viewIfLoaded?.window != nil) }
            }
            return
        }
        pending = nil
        move(to: path, animated: animated)
    }

    /// Keeps the pages the stack shares with `path`, so a project stays while a view over it goes.
    private func move(to path: [PhoneRoute], animated: Bool) {
        guard path != routes else { return }
        let stack = viewControllers
        var kept = 1
        var matched = 0
        while kept < stack.count, matched < path.count, let page = stack[kept] as? PhonePageController,
            page.route == path[matched]
        {
            kept += 1
            matched += 1
        }
        let added = path[matched...].map(makePage)
        if added.isEmpty {
            popToViewController(stack[kept - 1], animated: animated)
        } else if kept == stack.count, added.count == 1, let page = added.first {
            pushViewController(page, animated: animated)
        } else {
            setViewControllers(Array(stack.prefix(kept)) + added, animated: animated)
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        appeared(phoneTab)
    }

    func navigationController(
        _ navigationController: UINavigationController, didShow viewController: UIViewController, animated: Bool
    ) {
        if pending != nil {
            showPending(animated: viewIfLoaded?.window != nil)
        } else {
            settled(phoneTab, routes)
        }
    }
}

/// The iPhone's tabs. Each tab is a stack of its own, so a list-level page keeps the tab bar and a view hides it
/// with the push, and UIKit owns the transition and the swipe back.
final class PhoneTabController: UITabBarController {
    let stacks: [PhoneTab: PhoneStackController]
    private let tabsByPhoneTab: [PhoneTab: UITab]

    init(roots: [PhoneTab: PhonePageController]) {
        var stacks: [PhoneTab: PhoneStackController] = [:]
        var tabs: [PhoneTab: UITab] = [:]
        for tab in PhoneTab.allCases {
            let stack = PhoneStackController(
                tab: tab, root: roots[tab] ?? PhonePageController(route: nil, page: AnyView(EmptyView())))
            stacks[tab] = stack
            if tab == .search {
                let search = UISearchTab { _ in stack }
                search.automaticallyActivatesSearch = true
                tabs[tab] = search
            } else {
                tabs[tab] = UITab(
                    title: tab.title, image: LucideIcon.uiImage(named: tab.icon), identifier: tab.rawValue
                ) { _ in stack }
            }
        }
        self.stacks = stacks
        tabsByPhoneTab = tabs
        super.init(nibName: nil, bundle: nil)
        self.tabs = PhoneTab.allCases.compactMap { tabs[$0] }
        tabBarMinimizeBehavior = .onScrollDown
    }

    required init?(coder aDecoder: NSCoder) {
        nil
    }

    /// Shows the router's state. A path changes animated only on the tab that stays on screen; a tab the router
    /// switches to arrives with its pages already in place.
    func show(tab: PhoneTab, paths: [PhoneTab: [PhoneRoute]], needsYou: Int) {
        let current = selectedPhoneTab
        let visible = viewIfLoaded?.window != nil
        for (phoneTab, stack) in stacks {
            stack.show(paths[phoneTab] ?? [], animated: visible && phoneTab == tab && current == tab)
        }
        if current != tab, let selection = tabsByPhoneTab[tab] {
            selectedTab = selection
        }
        tabsByPhoneTab[.now]?.badgeValue = needsYou > 0 ? String(needsYou) : nil
    }

    private var selectedPhoneTab: PhoneTab? {
        tabsByPhoneTab.first { $0.value === selectedTab }?.key
    }
}
