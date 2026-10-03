import RuimtePulsar
import SwiftUI
import UIKit

/// What a page's bar items ask of the SwiftUI page under them. On an iPhone those items exist before the page lays
/// itself out, so the sheet one opens cannot be the page's own state.
@MainActor @Observable final class BarRequests {
    var newChat = false
    var openFolder = false
}

/// A page's bar items in UIKit, on its navigation item from the moment the page exists. SwiftUI hands a `.toolbar` to
/// the navigation item only a layout pass after the push started, so the bar had nothing to morph into and the items
/// popped in a frame late.
struct PhoneBar {
    /// Leading to trailing, so the avatar goes last.
    let items: [UIBarButtonItem]
    /// Brings the items and the title up to date, and runs again whenever something it read changes.
    let update: @MainActor (UINavigationItem) -> Void
}

/// The bars of the tabs, a project and a machine. Each ends on the avatar into Settings.
@MainActor struct PhoneBars {
    let runtime: AppRuntime
    let showSettings: () -> Void

    func now(requests: BarRequests) -> PhoneBar {
        let newChat = UIBarButtonItem(primaryAction: UIAction(image: Self.icon("square-pen")) { _ in
            requests.newChat = true
        })
        Self.name(newChat, "New chat", id: "now.newChat")
        return bar([newChat]) { [runtime] _ in newChat.isHidden = runtime.machines.isEmpty }
    }

    func projects(_ projects: UnifiedProjects) -> PhoneBar {
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.startAnimating()
        let updating = UIBarButtonItem(customView: spinner)
        updating.hidesSharedBackground = true
        Self.name(updating, "Updating projects", id: "projects.updating")
        return bar([updating]) { [runtime] _ in
            updating.isHidden = !(runtime.loading || projects.loading) || projects.open.isEmpty
        }
    }

    func machines(pair: @escaping () -> Void, signIn: @escaping () -> Void) -> PhoneBar {
        let add = UIBarButtonItem(image: Self.icon("plus"), menu: nil)
        Self.name(add, "Add a machine", id: "machines.add")
        return bar([add]) { [runtime] _ in
            var actions = [UIAction(title: "Use a pairing link", image: Self.icon("link")) { _ in pair() }]
            if runtime.account == nil {
                actions.append(UIAction(title: "Sign in", image: Self.icon("circle-user-round")) { _ in signIn() })
            }
            add.menu = UIMenu(children: actions)
        }
    }

    func search() -> PhoneBar {
        bar([]) { _ in }
    }

    /// The project's menu, built from the same actions as the iPad's. The Chats project's folder is the machine's
    /// own, so its menu holds New chat and Usage only.
    func project(_ navigation: WorkspaceNavigation) -> PhoneBar {
        let menu = UIBarButtonItem(image: Self.icon("ellipsis"), menu: nil)
        Self.name(menu, "Project menu", id: "project.menu")
        return bar([menu]) { item in
            let workspace = navigation.workspace
            item.title = workspace.title
            item.subtitle = workspace.session.machine.name
            item.largeTitleDisplayMode = .never
            menu.isEnabled = workspace.ready
            let kind = UIMenu.Identifier(workspace.isScratch ? "project.menu.chats" : "project.menu.views")
            if menu.menu?.identifier != kind {
                menu.menu = Self.projectMenu(navigation, kind: kind)
            }
        }
    }

    private static func projectMenu(_ navigation: WorkspaceNavigation, kind: UIMenu.Identifier) -> UIMenu {
        let scratch = navigation.workspace.isScratch
        let create =
            scratch
            ? UIAction(title: "New chat", image: icon("message-square-plus")) { _ in navigation.newChat = true }
            : UIAction(title: "New view", image: icon("plus")) { _ in navigation.adding = true }
        var panels: [UIAction] = []
        if !scratch {
            panels += [
                UIAction(title: "Files", image: icon("folder")) { _ in navigation.showingFiles = true },
                UIAction(title: "Git", image: icon("git-branch")) { _ in navigation.showingGit = true },
                UIAction(title: "Launches", image: icon("rocket")) { _ in navigation.showingLaunches = true },
            ]
        }
        panels.append(
            UIAction(title: "Usage", image: icon("chart-no-axes-column")) { _ in navigation.showingUsage = true })
        return UIMenu(
            identifier: kind,
            children: [
                UIMenu(options: .displayInline, children: [create]),
                UIMenu(options: .displayInline, children: panels),
            ])
    }

    /// A machine that is gone has the avatar only.
    func machine(_ session: SharedMachineSession?, requests: BarRequests) -> PhoneBar {
        guard let session else { return bar([]) { _ in } }
        let openFolder = UIBarButtonItem(primaryAction: UIAction(image: Self.icon("folder-open")) { _ in
            requests.openFolder = true
        })
        Self.name(openFolder, "Open folder", id: "machine.openFolder")
        return bar([openFolder]) { item in
            item.title = session.machine.name
            openFolder.isEnabled = session.connected
        }
    }

    /// The avatar takes one identifier on every page, so the next page's bar finds it at the same spot and morphs
    /// only what changes around it. Each page has an instance of its own, since both bars stand during a push.
    private func bar(_ items: [UIBarButtonItem], update: @escaping @MainActor (UINavigationItem) -> Void) -> PhoneBar {
        let avatar = UIBarButtonItem(primaryAction: UIAction { [showSettings] _ in showSettings() })
        Self.name(avatar, "Settings", id: "settings")
        avatar.accessibilityIdentifier = "home.settings"
        return PhoneBar(items: items + [avatar]) { [runtime] item in
            avatar.image = AccountAvatar.uiImage(
                for: runtime.account, picture: AccountPictures.shared.picture(for: runtime.account))
            update(item)
        }
    }

    private static func name(_ item: UIBarButtonItem, _ label: String, id: String) {
        item.identifier = id
        item.accessibilityLabel = label
        item.accessibilityIdentifier = id
    }

    private static func icon(_ name: String) -> UIImage {
        LucideIcon.uiImage(named: name)
    }
}

extension View {
    /// A `.toolbar` only where SwiftUI owns the bar: on an iPhone's tabs and pages the bar's items are UIKit's
    /// (`PhoneBar`), and SwiftUI is given no toolbar there to hand over in their place.
    @ViewBuilder func toolbar<Items: ToolbarContent>(
        if shown: Bool, @ToolbarContentBuilder _ items: () -> Items
    ) -> some View {
        if shown { toolbar(content: items) } else { self }
    }
}
