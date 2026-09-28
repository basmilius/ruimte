import PDFKit
import SwiftUI

/// PDFKit's own view: the pages under each other, pinch-zoom and text selection. `page` counts from one.
struct FilePDFView: UIViewRepresentable {
    let document: PDFDocument
    @Binding var page: Int

    func makeCoordinator() -> Coordinator { Coordinator(page: $page) }

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.autoScales = true
        view.backgroundColor = MobileStyle.canvasColor
        view.document = document
        NotificationCenter.default.addObserver(
            context.coordinator, selector: #selector(Coordinator.pageChanged(_:)), name: .PDFViewPageChanged,
            object: view)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        context.coordinator.page = $page
        if view.document !== document { view.document = document }
    }

    static func dismantleUIView(_ view: PDFView, coordinator: Coordinator) {
        NotificationCenter.default.removeObserver(coordinator, name: .PDFViewPageChanged, object: view)
    }

    @MainActor final class Coordinator: NSObject {
        var page: Binding<Int>
        init(page: Binding<Int>) { self.page = page }

        @objc func pageChanged(_ notification: Notification) {
            guard let view = notification.object as? PDFView, let document = view.document,
                let current = view.currentPage
            else { return }
            page.wrappedValue = document.index(for: current) + 1
        }
    }
}
