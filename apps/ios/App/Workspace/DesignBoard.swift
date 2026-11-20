import CoreGraphics
import Foundation
import Observation

/// A design page that asks to be a board with `<meta name="ruimte-design" content="canvas">`: a wide page with options
/// side by side, shown whole and then panned and zoomed. The desktop's runtime (`design-runtime.ts`) draws a board in
/// a frame it talks to over `postMessage`, which a page that is the web view's own document has no parent for, so here
/// the page's markup is moved into a world as the runtime moves it, and the app places that world by the same fit.
enum DesignBoard {
    /// Where the world stands in the page and how far it is scaled, in the page's own pixels.
    struct Camera: Equatable {
        let x: Double
        let y: Double
        let zoom: Double
    }

    /// The runtime's `PAD` and `ZOOM_MIN`.
    static let pad = 48.0
    static let minZoom = 0.1

    /// The runtime's `fitAll`: a wide board fits its width, a narrow one stays at its own size, and a board shorter
    /// than the frame stands in the middle, while a tall one starts at its top, the way a long page reads.
    static func fit(board: CGSize, frame: CGSize) -> Camera {
        let width = max(Double(board.width), 1)
        let height = Double(board.height)
        let zoom = max(minZoom, min(1, (Double(frame.width) - 2 * pad) / width))
        return Camera(
            x: max(pad, (Double(frame.width) - width * zoom) / 2),
            y: max(pad, (Double(frame.height) - height * zoom) / 2), zoom: zoom)
    }

    /// How much of the page the placed world takes, its margin past the far edges included, so the page scrolls over
    /// all of it and no further.
    static func extent(board: CGSize, camera: Camera) -> CGSize {
        CGSize(
            width: camera.x + max(Double(board.width), 1) * camera.zoom + pad,
            height: camera.y + Double(board.height) * camera.zoom + pad)
    }

    /// Whether a page asks to be a board, as the runtime's `meta[name="ruimte-design"][content="canvas"]` finds it:
    /// attribute names in any case, the values exactly.
    static func isBoard(_ page: Data) -> Bool {
        guard page.range(of: Data("ruimte-design".utf8)) != nil else { return false }
        let html = String(decoding: page, as: UTF8.self)
        var from = html.startIndex
        while let open = html.range(of: "<meta", options: .caseInsensitive, range: from..<html.endIndex) {
            guard let close = html.range(of: ">", range: open.upperBound..<html.endIndex) else { return false }
            from = close.upperBound
            let tag = String(html[open.upperBound..<close.lowerBound])
            if let first = tag.first, !first.isWhitespace, first != "/" {
                continue
            }
            let attributes = attributes(of: tag)
            if attributes["name"] == "ruimte-design", attributes["content"] == "canvas" {
                return true
            }
        }
        return false
    }

    private static let attribute = try! NSRegularExpression(
        pattern: #"([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?"#)

    /// The first value of each attribute by its lowercased name, as a parser keeps the first of a repeated one.
    private static func attributes(of tag: String) -> [String: String] {
        let source = tag as NSString
        var found: [String: String] = [:]
        for match in attribute.matches(in: tag, range: NSRange(location: 0, length: source.length)) {
            let name = source.substring(with: match.range(at: 1)).lowercased()
            guard found[name] == nil else { continue }
            let value = (2...4).map { match.range(at: $0) }.first { $0.location != NSNotFound }
            found[name] = value.map { source.substring(with: $0) } ?? ""
        }
        return found
    }

    /// Runs in the app's world once the page's markup is there, only in a board: moves the markup into a world as the
    /// runtime does, and reports the world's size and the frame's whenever either changes, for the app to place it.
    /// The viewport takes the device's width at a scale of one, so a pinch starts from the fit, and lets a pinch go
    /// further in than a page usually allows, since a fitted board starts far out.
    static let script = """
        (function () {
        if (window.__ruimteBoard || !document.body) { return; }
        var handler = window.webkit.messageHandlers.visual;
        var root = document.documentElement;
        var head = document.head || root;
        var viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
            viewport = document.createElement('meta');
            viewport.setAttribute('name', 'viewport');
            head.appendChild(viewport);
        }
        viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=10');
        var body = document.body;
        var world = document.createElement('div');
        world.id = 'ruimte-design-world';
        while (body.firstChild) { world.appendChild(body.firstChild); }
        body.appendChild(world);
        var extent = document.createElement('div');
        body.appendChild(extent);
        var style = document.createElement('style');
        style.textContent = '#ruimte-design-world { position: absolute; left: 0; top: 0; width: max-content; min-width: 100vw; transform-origin: 0 0; }';
        head.appendChild(style);
        extent.style.cssText = 'position: absolute; left: 0; top: 0; width: 0; height: 0; visibility: hidden; pointer-events: none;';
        var reported = '';
        var scheduled = false;
        function measure() {
            scheduled = false;
            var size = { kind: 'board', width: world.scrollWidth, height: world.scrollHeight, frameWidth: root.clientWidth, frameHeight: root.clientHeight };
            var key = size.width + 'x' + size.height + ':' + size.frameWidth + 'x' + size.frameHeight;
            if (key === reported) { return; }
            reported = key;
            handler.postMessage(size);
        }
        function schedule() {
            if (!scheduled) { scheduled = true; requestAnimationFrame(measure); }
        }
        if (typeof ResizeObserver === 'function') { new ResizeObserver(schedule).observe(world); }
        addEventListener('resize', schedule);
        window.__ruimteBoard = {
            place: function (x, y, zoom, width, height) {
                world.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + zoom + ')';
                extent.style.width = width + 'px';
                extent.style.height = height + 'px';
            }
        };
        schedule();
        })();
        """
}

/// Where a person left one board: whether they moved it, and if so, the world's camera and the view's own zoom and
/// scroll, so a page written again opens as they left it. A page they did not touch fits again.
@MainActor @Observable
final class DesignBoardCamera {
    /// Whether the page shown is a board, known once it was read.
    var isBoard = false
    /// Counts the times a person asked for the whole board again.
    private(set) var fits = 0
    @ObservationIgnored var touched = false
    @ObservationIgnored var world: DesignBoard.Camera?
    @ObservationIgnored var view: (zoom: CGFloat, offset: CGPoint)?

    func fit() {
        fits += 1
    }
}

/// The camera of each page a design shows, kept while the design is open, as the desktop keeps one per page.
@MainActor final class DesignBoardCameras {
    private var cameras: [String: DesignBoardCamera] = [:]

    func camera(_ page: String) -> DesignBoardCamera {
        if let known = cameras[page] {
            return known
        }
        let camera = DesignBoardCamera()
        cameras[page] = camera
        return camera
    }
}
