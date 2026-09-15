import SwiftUI

struct MobileSidebarList: ViewModifier {
    var enabled = true

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content
                .listStyle(.plain)
                .listSectionSpacing(0)
                .environment(\.defaultMinListRowHeight, 44)
                .scrollContentBackground(.hidden)
                .background(MobileStyle.surface)
        } else {
            content.listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(MobileStyle.canvas)
        }
    }
}

struct MobileSidebarRow: ViewModifier {
    var enabled = true
    let selected: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content
                .listRowInsets(EdgeInsets(top: 1, leading: 10, bottom: 1, trailing: 10))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .accessibilityAddTraits(selected ? .isSelected : [])
        } else {
            content
        }
    }
}

struct MobileSidebarLabel: ViewModifier {
    var enabled = true
    let selected: Bool
    @State private var hovered = false

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content
                .font(.callout)
                .foregroundStyle(selected || hovered ? MobileStyle.text : MobileStyle.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(minHeight: 44)
                .background(
                    selected ? MobileStyle.active : hovered ? MobileStyle.hover : .clear,
                    in: RoundedRectangle(cornerRadius: 8)
                )
                .contentShape(RoundedRectangle(cornerRadius: 8))
                .onHover { hovered = $0 }
        } else {
            content
        }
    }
}
