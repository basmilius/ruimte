import SwiftUI

private struct MobileSheetSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(MobileStyle.text)
            .tint(MobileStyle.accent)
            .toggleStyle(SystemToggleStyle())
            // Sheets have their own surface instead of borrowing color from the view underneath.
            .presentationBackground(MobileStyle.surface)
    }
}

extension View {
    func mobileSheet<Content: View>(
        isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        sheet(isPresented: isPresented, onDismiss: onDismiss) { content().modifier(MobileSheetSurface()) }
    }

    func mobileSheet<Item: Identifiable, Content: View>(
        item: Binding<Item?>, onDismiss: (() -> Void)? = nil,
        @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        sheet(item: item, onDismiss: onDismiss) { content($0).modifier(MobileSheetSurface()) }
    }
}
