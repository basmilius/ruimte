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
            .buttonStyle(MobileSidebarButtonStyle(selected: selected))
            .listRowInsets(EdgeInsets(top: 1, leading: 18, bottom: 1, trailing: 18))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct MobileSidebarLabel: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.callout)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct MobileSidebarButtonStyle: ButtonStyle {
    var selected: Bool

    func makeBody(configuration: Configuration) -> some View {
        MobileSidebarButtonSurface(selected: selected, pressed: configuration.isPressed, label: configuration.label)
    }
}

private struct MobileSidebarButtonSurface<Label: View>: View {
    let selected: Bool
    let pressed: Bool
    let label: Label
    @State private var hovered = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        label
            .foregroundStyle(selected || hovered || pressed ? MobileStyle.text : MobileStyle.muted)
            .background(
                pressed ? MobileStyle.pressed : selected ? MobileStyle.active : hovered ? MobileStyle.hover : .clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: pressed)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: hovered)
            .onHover { hovered = $0 }
    }
}

struct SidebarBrand: View {
    var body: some View {
        HStack(spacing: 10) {
            Image("RuimteLogo").renderingMode(.original)
                .resizable().scaledToFit()
                .padding(4)
                .frame(width: 32, height: 32)
                .background(.white, in: RoundedRectangle(cornerRadius: 8))
            Text("Ruimte").font(.title3.weight(.semibold)).foregroundStyle(MobileStyle.text)
        }
        .padding(.leading, 8)
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
