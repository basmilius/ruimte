import ImageIO
import SwiftUI
import UIKit

/// A picture decoded by ImageIO, which reads every format the system does: HEIC, HEIF, AVIF, TIFF, BMP and ICO too.
struct FileImage: Sendable {
    let image: UIImage
    /// The size the file declares, upright; the picture on screen may be smaller.
    let pixelWidth: Int
    let pixelHeight: Int

    /// `longestSide` bounds what is held in memory: a 48-megapixel photo decoded whole takes 190 MB.
    static func decode(_ data: Data, longestSide: Int = 4096) -> FileImage? {
        guard
            let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let frames = (0..<CGImageSourceGetCount(source)).compactMap { index -> (index: Int, width: Int, height: Int)? in
            guard let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any],
                let width = properties[kCGImagePropertyPixelWidth] as? Int,
                let height = properties[kCGImagePropertyPixelHeight] as? Int
            else { return nil }
            let orientation = properties[kCGImagePropertyOrientation] as? UInt32 ?? 1
            return orientation >= 5 ? (index, height, width) : (index, width, height)
        }
        // An icon file holds a picture per size, and the largest is the one to look at; an animation starts at its first.
        guard let frame = frames.max(by: { $0.width * $0.height < $1.width * $1.height }),
            let picture = CGImageSourceCreateThumbnailAtIndex(
                source, frame.index,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceShouldCacheImmediately: true,
                    kCGImageSourceThumbnailMaxPixelSize: min(max(frame.width, frame.height), longestSide),
                ] as CFDictionary)
        else { return nil }
        return FileImage(image: UIImage(cgImage: picture), pixelWidth: frame.width, pixelHeight: frame.height)
    }
}

/// A picture that fits the page and zooms with a pinch or a double tap, the way Photos does.
struct FileImageView: UIViewRepresentable {
    let image: UIImage
    let name: String

    func makeUIView(context: Context) -> ZoomingImageView { ZoomingImageView() }

    func updateUIView(_ view: ZoomingImageView, context: Context) {
        view.show(image)
        view.imageView.accessibilityLabel = name
    }
}

final class ZoomingImageView: UIScrollView, UIScrollViewDelegate {
    let imageView = UIImageView()
    private var shown: UIImage?
    private var fittedBounds = CGSize.zero

    init() {
        super.init(frame: .zero)
        delegate = self
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        imageView.isAccessibilityElement = true
        imageView.accessibilityTraits = .image
        addSubview(imageView)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(toggleZoom(_:)))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func show(_ image: UIImage) {
        guard image !== shown else { return }
        shown = image
        imageView.image = image
        zoomScale = 1
        imageView.frame = CGRect(origin: .zero, size: image.size)
        contentSize = image.size
        fittedBounds = .zero
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let shown, bounds.width > 0, bounds.height > 0, shown.size.width > 0, shown.size.height > 0 else {
            return
        }
        if fittedBounds != bounds.size {
            let atRest = fittedBounds == .zero || zoomScale <= minimumZoomScale
            // A small picture keeps one point per pixel instead of growing into a blur.
            let fit = min(bounds.width / shown.size.width, bounds.height / shown.size.height, 1)
            minimumZoomScale = fit
            maximumZoomScale = max(fit * 8, 2)
            fittedBounds = bounds.size
            if atRest { zoomScale = fit }
        }
        centerImage()
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) { centerImage() }

    private func centerImage() {
        let horizontal = max((bounds.width - contentSize.width) / 2, 0)
        let vertical = max((bounds.height - contentSize.height) / 2, 0)
        let inset = UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
        if contentInset != inset { contentInset = inset }
    }

    @objc private func toggleZoom(_ gesture: UITapGestureRecognizer) {
        if zoomScale > minimumZoomScale {
            setZoomScale(minimumZoomScale, animated: true)
            return
        }
        let scale = min(max(minimumZoomScale * 3, 1), maximumZoomScale)
        let point = gesture.location(in: imageView)
        let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
        zoom(
            to: CGRect(
                x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height),
            animated: true)
    }
}

/// The line under a preview with what the file is, as the desktop viewer writes it under its own.
struct FileFooter: View {
    let items: [String]

    var body: some View {
        HStack(spacing: 12) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                Text(verbatim: item).lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 0)
        }
        .font(.caption).monospacedDigit().foregroundStyle(MobileStyle.muted)
        .textSelection(.enabled)
        .padding(.horizontal, 16).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Divider().overlay(MobileStyle.border) }
        .accessibilityElement(children: .combine)
    }
}
