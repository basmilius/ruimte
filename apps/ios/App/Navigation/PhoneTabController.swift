import SwiftUI
import UIKit

/// A controller on one of the iPhone's stacks that stands for a route.
protocol PhoneRouted: UIViewController {
    var route: PhoneRoute? { get }
}

/// A SwiftUI page on one of the iPhone's stacks.
final class PhonePageController: UIHostingController<AnyView>, PhoneRouted {
    /// Nil for a tab's root.
    let route: PhoneRoute?

    init(route: PhoneRoute?, page: AnyView) {
        self.route = route
        super.init(rootView: page)
    }

    required init?(coder aDecoder: NSCoder) {
        nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MobileStyle.surfaceColor
    }
}

/// A stack that pushes and pops to match a path in `PhoneRouter`: a tab's list-level pages, or the views over the
/// tabs.
class PhoneStackController: UINavigationController, UINavigationControllerDelegate {
    /// Builds the page of a route.
    var makePage: (PhoneRoute) -> PhonePageController = { PhonePageController(route: $0, page: AnyView(EmptyView())) }
    /// Hands the routes this stack holds to the router once a push or a pop settled.
    var settled: ([PhoneRoute]) -> Void = { _ in }
    /// The last path the router asked for. The router repeats it on every update, and repeating it while a swipe
    /// back runs must not push the page back once the swipe lands.
    private var requested: [PhoneRoute] = []
    /// A path asked for during a transition, shown once the transition ends.
    private var pending: [PhoneRoute]?

    init(root: UIViewController) {
        super.init(rootViewController: root)
        delegate = self
        navigationBar.prefersLargeTitles = true
    }

    required init?(coder aDecoder: NSCoder) {
        nil
    }

    /// The routes on the stack. A page SwiftUI pushes from inside a page has none and keeps the route under it.
    var routes: [PhoneRoute] {
        viewControllers.compactMap { ($0 as? PhoneRouted)?.route }
    }

    /// What the stack pushes for a route.
    func controller(for route: PhoneRoute) -> UIViewController {
        makePage(route)
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
        while kept < stack.count, matched < path.count, let page = stack[kept] as? PhoneRouted,
            page.route == path[matched]
        {
            kept += 1
            matched += 1
        }
        let added = path[matched...].map(controller(for:))
        if added.isEmpty {
            popToViewController(stack[kept - 1], animated: animated)
        } else if kept == stack.count, added.count == 1, let page = added.first {
            pushViewController(page, animated: animated)
        } else {
            setViewControllers(Array(stack.prefix(kept)) + added, animated: animated)
        }
        if let top = added.last {
            layOutBeforeTransition(top)
        }
    }

    /// SwiftUI hands a page's title and toolbar to its navigation item only when it lays the page out, which UIKit
    /// does after the bar started the push, so the items would pop in at its end instead of morphing. The push
    /// waits for the next layout pass, so laying the page out now, on the stack, lands before it.
    private func layOutBeforeTransition(_ page: UIViewController) {
        guard page.viewIfLoaded?.window == nil else { return }
        page.view.frame = view.bounds
        page.view.layoutIfNeeded()
    }

    func navigationController(
        _ navigationController: UINavigationController, didShow viewController: UIViewController, animated: Bool
    ) {
        if pending != nil {
            showPending(animated: viewIfLoaded?.window != nil)
        } else {
            settled(routes)
        }
    }
}

/// One tab's stack: its root and the list-level pages over it, under the tab bar.
final class PhoneTabStackController: PhoneStackController {
    let phoneTab: PhoneTab
    /// Tells the router this tab is the one on screen, however it got selected.
    var appeared: (PhoneTab) -> Void = { _ in }

    init(tab: PhoneTab, root: PhonePageController) {
        phoneTab = tab
        super.init(root: root)
    }

    required init?(coder aDecoder: NSCoder) {
        nil
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        appeared(phoneTab)
    }
}

/// The iPhone's tabs, each a stack of its own, so a list-level page keeps the tab bar.
final class PhoneTabController: UITabBarController {
    let stacks: [PhoneTab: PhoneTabStackController]
    private let tabsByPhoneTab: [PhoneTab: UITab]

    init(roots: [PhoneTab: PhonePageController]) {
        var stacks: [PhoneTab: PhoneTabStackController] = [:]
        var tabs: [PhoneTab: UITab] = [:]
        for tab in PhoneTab.allCases {
            let stack = PhoneTabStackController(
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

    var selectedPhoneTab: PhoneTab? {
        tabsByPhoneTab.first { $0.value === selectedTab }?.key
    }
}

/// The stack around the tabs, which holds the views. A view covers the tabs and the tab bar, so the whole tabbed
/// page slides away with its push, since `hidesBottomBarWhenPushed` under the floating tab bar fades the bar's
/// background and drops its items at the end. Its own bar stays hidden: each tab's stack and each view
/// (`PhoneViewController`) has a bar of its own that slides with it.
final class PhoneRootController: PhoneStackController {
    let tabs: PhoneTabController
    private let popGesture = PhoneViewPopGesture()

    init(tabs: PhoneTabController) {
        self.tabs = tabs
        super.init(root: tabs)
        setNavigationBarHidden(true, animated: false)
    }

    required init?(coder aDecoder: NSCoder) {
        nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        popGesture.stack = self
        interactivePopGestureRecognizer?.delegate = popGesture
    }

    /// Shows the router's state. The views move animated unless the tab switches in sight, so a tab the router
    /// switches to arrives with its view already over it.
    func show(tab: PhoneTab, paths: [PhoneTab: [PhoneRoute]], views: [PhoneRoute], needsYou: Int) {
        let switchesInSight = tabs.selectedPhoneTab != tab && topViewController === tabs
        tabs.show(tab: tab, paths: paths, needsYou: needsYou)
        show(views, animated: viewIfLoaded?.window != nil && !switchesInSight)
    }

    override func controller(for route: PhoneRoute) -> UIViewController {
        let controller = PhoneViewController(page: makePage(route))
        controller.leave = { [weak self, weak controller] in
            guard let self, let controller, topViewController === controller else { return }
            popViewController(animated: true)
        }
        controller.depthChanged = { [weak self] in self?.updateContentPop() }
        return controller
    }

    /// A swipe back pops the view only while no page SwiftUI pushed inside it stands over it; that one goes back
    /// within the view's own stack.
    var canPopView: Bool {
        viewControllers.count > 1 && transitionCoordinator == nil && !holdsPushedPage
    }

    private var holdsPushedPage: Bool {
        (topViewController as? PhoneViewController)?.holdsPushedPage ?? false
    }

    private func updateContentPop() {
        interactiveContentPopGestureRecognizer?.isEnabled = !holdsPushedPage
    }

    override func navigationController(
        _ navigationController: UINavigationController, didShow viewController: UIViewController, animated: Bool
    ) {
        updateContentPop()
        super.navigationController(navigationController, didShow: viewController, animated: animated)
    }
}

/// UIKit turns the edge swipe back off while a stack's bar is hidden, which the stack around the tabs always is.
private final class PhoneViewPopGesture: NSObject, UIGestureRecognizerDelegate {
    weak var stack: PhoneRootController?

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        stack?.canPopView ?? false
    }
}

/// A view over the tabs, in a stack of its own, so its bar and back button are laid out with the view and slide in
/// and out with it as one page. A page SwiftUI pushes from inside the view (a chat's sub-agents, a canvas's nodes, a
/// group's members) goes on that stack and morphs in its bar.
final class PhoneViewController: UIViewController, PhoneRouted {
    let route: PhoneRoute?
    private let stack: PhoneViewStackController

    init(page: PhonePageController) {
        route = page.route
        stack = PhoneViewStackController(page: page)
        super.init(nibName: nil, bundle: nil)
        addChild(stack)
    }

    required init?(coder aDecoder: NSCoder) {
        nil
    }

    /// Leaves the stack around the tabs: the view's back button, and a pop that would uncover the empty page.
    var leave: () -> Void {
        get { stack.leave }
        set { stack.leave = newValue }
    }

    /// Called once a push or a pop inside the view settled.
    var depthChanged: () -> Void {
        get { stack.depthChanged }
        set { stack.depthChanged = newValue }
    }

    var holdsPushedPage: Bool {
        stack.holdsPushedPage
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MobileStyle.surfaceColor
        stack.view.frame = view.bounds
        stack.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(stack.view)
        stack.didMove(toParent: self)
    }
}

/// The stack inside a view. An empty page stands under the view, so the view gets the system's back button, whose
/// action leaves the stack around the tabs instead of uncovering it.
private final class PhoneViewStackController: UINavigationController, UINavigationControllerDelegate {
    var leave: () -> Void = {}
    var depthChanged: () -> Void = {}

    init(page: PhonePageController) {
        super.init(nibName: nil, bundle: nil)
        let under = UIViewController()
        under.navigationItem.backButtonDisplayMode = .minimal
        viewControllers = [under, page]
        page.navigationItem.backAction = UIAction { [weak self] _ in self?.leave() }
        delegate = self
    }

    required init?(coder aDecoder: NSCoder) {
        nil
    }

    var holdsPushedPage: Bool {
        viewControllers.count > 2
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        enablePopGestures()
    }

    /// SwiftUI's dismiss of the view lands here too.
    override func popViewController(animated: Bool) -> UIViewController? {
        guard holdsPushedPage else {
            leave()
            return nil
        }
        return super.popViewController(animated: animated)
    }

    override func popToRootViewController(animated: Bool) -> [UIViewController]? {
        guard holdsPushedPage else {
            leave()
            return nil
        }
        return super.popToViewController(viewControllers[1], animated: animated)
    }

    /// Only a page pushed inside the view swipes back here; the view itself goes back on the stack around the tabs.
    private func enablePopGestures() {
        interactivePopGestureRecognizer?.isEnabled = holdsPushedPage
        interactiveContentPopGestureRecognizer?.isEnabled = holdsPushedPage
    }

    func navigationController(
        _ navigationController: UINavigationController, didShow viewController: UIViewController, animated: Bool
    ) {
        enablePopGestures()
        depthChanged()
    }
}
