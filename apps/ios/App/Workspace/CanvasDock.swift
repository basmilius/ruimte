import SwiftUI

/// The desktop's dock under a canvas as two capsules of glass: what needs you and what works on the left, then adding
/// a node, fitting, the locks and the saved layouts.
struct CanvasDock: View {
    let status: CanvasStatus
    let locks: CanvasLocks
    let layouts: [String]
    let add: (String) -> Void
    let fit: () -> Void
    let openNext: () -> Void
    let setLocks: (CanvasLocks) -> Void
    let applyLayout: (String) -> Void
    let deleteLayout: (String) -> Void
    let saveLayout: () -> Void

    var body: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                if !status.isEmpty {
                    statusCapsule
                }
                HStack(spacing: 0) {
                    addMenu
                    Spacer(minLength: 0)
                    control("Fit canvas", icon: "scan", action: fit)
                    Spacer(minLength: 0)
                    lockMenu
                    Spacer(minLength: 0)
                    layoutMenu
                }
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private var statusCapsule: some View {
        HStack(spacing: 2) {
            if !status.needsYou.isEmpty {
                Button(action: openNext) {
                    HStack(spacing: 5) {
                        Circle().fill(MobileStyle.statusNeedsYou).frame(width: 7, height: 7)
                        Text("\(status.needsYou.count)").monospacedDigit()
                    }
                    .foregroundStyle(MobileStyle.statusNeedsYou)
                    .padding(.horizontal, 8).frame(minHeight: 44).contentShape(.rect)
                }
                .accessibilityLabel("\(status.needsYou.count) need you. Open the next one.")
            }
            if status.working > 0 {
                HStack(spacing: 5) {
                    Image(lucide: "loader-circle", size: 13)
                    Text("\(status.working)").monospacedDigit()
                }
                .foregroundStyle(MobileStyle.statusRunning)
                .padding(.horizontal, 8).frame(minHeight: 44)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(status.working) working")
            }
        }
        .font(.subheadline.weight(.semibold))
        .padding(.horizontal, 6)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private var addMenu: some View {
        Menu {
            Button("Chat", lucideIcon: "message-square") { add("chat") }
            Button("Terminal", lucideIcon: "terminal") { add("terminal") }
            Button("Browser", lucideIcon: "globe") { add("browser") }
            Button("File", lucideIcon: "file-text") { add("file") }
            Button("Note", lucideIcon: "sticky-note") { add("note") }
            Button("Group", lucideIcon: "layout-grid") { add("group") }
        } label: {
            icon("plus")
        }
        .accessibilityLabel("Add a node")
    }

    private var lockMenu: some View {
        Menu {
            Section("Refuse gestures") {
                Toggle(isOn: lockBinding(\.pan)) {
                    Text("Pan")
                    Text("The canvas stays in place")
                }
                Toggle(isOn: lockBinding(\.zoom)) {
                    Text("Zoom")
                    Text("Pinching is ignored")
                }
            }
            Section("The dock still works while locked.") {
                Button(
                    locks.all ? "Unlock everything" : "Lock everything",
                    lucideIcon: locks.all ? "lock-open" : "lock"
                ) {
                    setLocks(locks.locking(everything: !locks.all))
                }
            }
        } label: {
            icon(locks.any ? "lock" : "lock-open")
                .foregroundStyle(locks.any ? MobileStyle.accent : MobileStyle.text)
        }
        .accessibilityLabel(locks.any ? "Locked" : "Lock")
    }

    private var layoutMenu: some View {
        Menu {
            Section("Saved layouts") {
                if layouts.isEmpty {
                    Text("Nothing saved yet")
                }
                ForEach(layouts, id: \.self) { name in
                    Menu(name) {
                        Button("Apply", lucideIcon: "layout-template") { applyLayout(name) }
                        Button("Delete", lucideIcon: "trash", role: .destructive) { deleteLayout(name) }
                    }
                }
            }
            Button("Save current layout", lucideIcon: "save", action: saveLayout)
        } label: {
            icon("layout-template")
        }
        .accessibilityLabel("Layouts")
    }

    private func lockBinding(_ path: WritableKeyPath<CanvasLocks, Bool>) -> Binding<Bool> {
        Binding(
            get: { locks[keyPath: path] },
            set: { value in
                var next = locks
                next[keyPath: path] = value
                setLocks(next)
            })
    }

    private func control(_ label: String, icon name: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { icon(name) }.accessibilityLabel(label)
    }

    private func icon(_ name: String) -> some View {
        Image(lucide: name, size: 18).frame(width: 48, height: 48).contentShape(.rect)
    }
}
