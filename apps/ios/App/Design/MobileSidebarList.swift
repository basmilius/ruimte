import SwiftUI

struct MobileSidebarList: ViewModifier {
    func body(content: Content) -> some View {
        content
            .listStyle(.plain)
            .listSectionSpacing(0)
            .environment(\.defaultMinListRowHeight, 44)
            .scrollContentBackground(.hidden)
            .background(MobileStyle.surface)
    }
}

struct MobileSidebarRow: ViewModifier {
    var selected = false

    func body(content: Content) -> some View {
        content
            .listRowInsets(EdgeInsets(top: 1, leading: 18, bottom: 1, trailing: 18))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct MobileSidebarLabel: ViewModifier {
    var selected = false
    @State private var hovered = false

    func body(content: Content) -> some View {
        content
            .font(.callout)
            .foregroundStyle(selected || hovered ? MobileStyle.text : MobileStyle.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(
                selected ? MobileStyle.active : hovered ? MobileStyle.hover : .clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
            .contentShape(RoundedRectangle(cornerRadius: 8))
            .onHover { hovered = $0 }
    }
}

struct SidebarBrand: View {
    var body: some View {
        HStack(spacing: 8) {
            Image("RuimteLogo").renderingMode(.original)
                .resizable().scaledToFit()
                .padding(4)
                .frame(width: 28, height: 28)
                .background(.white, in: RoundedRectangle(cornerRadius: 7))
            Text("Ruimte").font(.headline).foregroundStyle(MobileStyle.text)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Ruimte")
    }
}

struct SidebarBounds: PreferenceKey {
    static let defaultValue: Anchor<CGRect>? = nil

    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

struct SidebarDivider: View {
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        // Cover the native split divider before drawing one web-colored physical pixel.
        MobileStyle.surface.frame(width: 2)
            .overlay(alignment: .leading) {
                MobileStyle.border.frame(width: 1 / displayScale).offset(x: 1)
            }
    }
}
