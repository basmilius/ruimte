import SwiftUI
import UIKit

struct MobileScrollViewport<Content: View>: View {
    var edges: Edge.Set = .vertical
    @ViewBuilder var content: (UIEdgeInsets) -> Content

    var body: some View {
        GeometryReader { geometry in
            content(
                UIEdgeInsets(
                    top: edges.contains(.top) ? geometry.safeAreaInsets.top : 0,
                    left: 0,
                    bottom: edges.contains(.bottom) ? geometry.safeAreaInsets.bottom : 0,
                    right: 0)
            )
            .ignoresSafeArea(.container, edges: edges)
        }
    }
}
