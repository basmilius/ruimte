import SwiftUI

struct MobileSidebarList: ViewModifier {
    var minimumRowHeight: CGFloat = 44

    func body(content: Content) -> some View {
        content
            .listStyle(.plain)
            .listSectionSpacing(0)
            .environment(\.defaultMinListRowHeight, minimumRowHeight)
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
    @GestureState private var pressed = false

    func body(content: Content) -> some View {
        content
            .font(.callout)
            .foregroundStyle(selected || hovered || pressed ? MobileStyle.text : MobileStyle.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(
                pressed ? MobileStyle.pressed : selected ? MobileStyle.active : hovered ? MobileStyle.hover : .clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
            .contentShape(RoundedRectangle(cornerRadius: 8))
            .onHover { hovered = $0 }
            // Keep the native List button action; this gesture only tracks visual feedback.
            .simultaneousGesture(
                LongPressGesture(minimumDuration: .infinity, maximumDistance: 10)
                    .updating($pressed) { value, pressed, _ in pressed = value }
            )
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
        .fixedSize(horizontal: true, vertical: false)
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
