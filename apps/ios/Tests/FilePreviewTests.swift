import AVFoundation
import AVKit
import PDFKit
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit
import XCTest

@testable import Ruimte

final class FilePreviewTests: XCTestCase {
    private let english = Locale(identifier: "en_US")

    func testAListedFileGetsTheMarkOfItsKind() {
        let expected = [
            ("src", "directory", "folder"), ("link", "symlink", "file-symlink"), ("main.ts", "file", "file-code"),
            ("App.vue", "file", "file-code"), ("package.json", "file", "file-braces"),
            ("build.sh", "file", "file-terminal"), ("photo.heic", "file", "file-image"),
            ("cover.avif", "file", "file-image"), ("favicon.ico", "file", "file-image"),
            ("song.mp3", "file", "file-music"), ("voice.opus", "file", "file-music"),
            ("clip.mov", "file", "file-play"), ("backup.zip", "file", "file-archive"),
            ("table.csv", "file", "file-spreadsheet"), ("manual.pdf", "file", "file-text"),
            ("README.md", "file", "file-text"), ("fix.patch", "file", "file-diff"), ("Font.woff2", "file", "file-type"),
            ("Makefile", "file", "file"), ("notes.unknownext", "file", "file"),
        ]
        for (name, kind, icon) in expected {
            XCTAssertEqual(FileKinds.icon(name: name, kind: kind), icon, name)
        }
    }

    func testTheMachinesLanguageIsTranslatedOnlyWhereHighlightJSNamesItOtherwise() async throws {
        XCTAssertEqual(FileKinds.highlightLanguage("typescript"), "typescript")
        XCTAssertEqual(FileKinds.highlightLanguage("tsx"), "tsx")
        XCTAssertEqual(FileKinds.highlightLanguage("vue"), "xml")
        XCTAssertEqual(FileKinds.highlightLanguage("shellscript"), "bash")
        XCTAssertEqual(FileKinds.highlightLanguage("dotenv"), "bash")
        XCTAssertEqual(FileKinds.highlightLanguage("jsonc"), "jsonc")
        XCTAssertEqual(FileKinds.highlightLanguage("ignore"), "plaintext")
        XCTAssertEqual(FileKinds.highlightLanguage(nil), "plaintext")
        XCTAssertEqual(FileKinds.highlightLanguage(""), "plaintext")
        for (language, source) in [
            ("typescript", "export const answer: number = 42;"), ("tsx", "const view = <div>Hello</div>;"),
            ("vue", "<template><p>Hello</p></template>"), ("shellscript", "echo \"Hello\""),
            ("jsonc", "{\"answer\": 42}"),
        ] {
            let highlighted = await CodeHighlighter.shared.highlight(
                source, language: FileKinds.highlightLanguage(language), dark: false)
            let rendered = try XCTUnwrap(highlighted, language)
            XCTAssertEqual(String(rendered.characters), source)
            XCTAssertGreaterThan(Set(rendered.runs.compactMap { $0.swiftUI.foregroundColor }).count, 1, language)
        }
    }

    func testAPlaybackPositionIsWrittenLikeTheRestOfTheRecording() {
        XCTAssertEqual(FileKinds.playbackClock(0, total: 200, locale: english), "0:00")
        XCTAssertEqual(FileKinds.playbackClock(65.9, total: 200, locale: english), "1:05")
        XCTAssertEqual(FileKinds.playbackClock(65, total: 4000, locale: english), "0:01:05")
        XCTAssertEqual(FileKinds.playbackClock(-3, total: 200, locale: english), "0:00")
        XCTAssertEqual(FileKinds.playbackClock(.nan, total: 200, locale: english), "0:00")
    }

    func testOnlyWhatTheMachineServesAndMemoryHoldsIsFetchedWhole() {
        for mime in ["image/heic", "video/mp4", "audio/ogg", "application/pdf"] {
            XCTAssertTrue(FileKinds.machineServes(mime: mime), mime)
        }
        for mime in ["application/zip", "application/octet-stream", "text/plain"] {
            XCTAssertFalse(FileKinds.machineServes(mime: mime), mime)
        }
        XCTAssertTrue(FileKinds.fitsInMemory(size: WireConstants.bytesReadMaxBytes))
        XCTAssertFalse(FileKinds.fitsInMemory(size: WireConstants.bytesReadMaxBytes + 1))
        XCTAssertFalse(FileKinds.fitsInMemory(size: nil))
    }

    func testEveryPictureFormatDecodesAtItsOwnSize() throws {
        for ext in ["png", "jpg", "gif", "webp", "heic", "heif", "avif", "tiff", "bmp"] {
            let image = try XCTUnwrap(FileImage.decode(try fixture("image.\(ext)")), ext)
            XCTAssertEqual([image.pixelWidth, image.pixelHeight], [64, 48], ext)
            XCTAssertEqual(image.image.size, CGSize(width: 64, height: 48), ext)
        }
        let icon = try XCTUnwrap(FileImage.decode(try fixture("image.ico")))
        XCTAssertEqual([icon.pixelWidth, icon.pixelHeight], [48, 48], "The largest of the icon's three sizes")
        let rotated = try XCTUnwrap(FileImage.decode(try fixture("rotated.jpg")))
        XCTAssertEqual([rotated.pixelWidth, rotated.pixelHeight], [48, 64], "Upright, as the orientation says")
        XCTAssertEqual(rotated.image.size, CGSize(width: 48, height: 64))
        XCTAssertNil(FileImage.decode(Data("not a picture".utf8)))
    }

    func testALargePictureIsHeldAtTheBoundItWasGiven() throws {
        let image = try XCTUnwrap(FileImage.decode(try fixture("image.png"), longestSide: 32))
        XCTAssertEqual([image.pixelWidth, image.pixelHeight], [64, 48])
        XCTAssertEqual(image.image.size, CGSize(width: 32, height: 24))
    }

    @MainActor func testEverySoundFormatPlaysThroughTheMachinesPieces() async throws {
        for (name, mime) in [
            ("tone.mp3", "audio/mpeg"), ("tone.m4a", "audio/mp4"), ("tone.aac", "audio/aac"),
            ("tone.wav", "audio/wav"), ("tone.flac", "audio/flac"),
        ] {
            let machine = FileMachine(path: "/files/\(name)", data: try fixture(name), mime: mime)
            let loader = MachineMediaLoader(client: machine, path: machine.path)
            let asset = loader.asset()
            let (playable, duration) = try await asset.load(.isPlayable, .duration)
            XCTAssertTrue(playable, name)
            let info = await FileAudioInfo.load(from: asset, duration: duration)
            XCTAssertEqual(info.duration, 1, accuracy: 0.2, name)
            if ["tone.mp3", "tone.m4a"].contains(name) {
                XCTAssertEqual(info.title, "Tone", name)
                XCTAssertEqual(info.artist, "Ruimte", name)
            }
            XCTAssertGreaterThan(machine.pieces, 0, name)
            loader.cancel()
        }
    }

    @MainActor func testEveryPictureFormatOpensInItsPageWithZoomAndAFooter() async throws {
        for (name, mime) in [
            ("image.png", "image/png"), ("image.jpg", "image/jpeg"), ("image.gif", "image/gif"),
            ("image.webp", "image/webp"), ("image.heic", "image/heic"), ("image.heif", "image/heif"),
            ("image.avif", "image/avif"), ("image.tiff", "image/tiff"), ("image.bmp", "image/bmp"),
            ("image.ico", "image/x-icon"),
        ] {
            let machine = FileMachine(path: "/files/\(name)", data: try fixture(name), mime: mime)
            let opened = try await open(machine, name: name) { view in
                guard let zooming = view.descendant(of: ZoomingImageView.self) else { return false }
                let dimensions = name == "image.ico" ? "48 × 48" : "64 × 48"
                let labels = NativePresentationProbe.labels(in: view).joined(separator: "\n")
                return zooming.imageView.image != nil && zooming.maximumZoomScale > zooming.minimumZoomScale
                    && labels.contains(dimensions) && labels.contains(mime)
            }
            XCTAssertTrue(opened, name)
        }
    }

    @MainActor func testAPDFOpensInPDFKit() async throws {
        let machine = FileMachine(
            path: "/files/document.pdf", data: try fixture("document.pdf"), mime: "application/pdf")
        let opened = try await open(machine, name: "document.pdf") { view in
            view.descendant(of: PDFView.self)?.document?.pageCount == 2
        }
        XCTAssertTrue(opened)
    }

    @MainActor func testSoundAndVideoOpenInTheirPlayers() async throws {
        for (name, mime, title) in [
            ("tone.mp3", "audio/mpeg", "Tone"), ("tone.m4a", "audio/mp4", "Tone"),
            ("tone.aac", "audio/aac", "tone.aac"), ("tone.wav", "audio/wav", "tone.wav"),
            ("tone.flac", "audio/flac", "tone.flac"), ("tone.opus", "audio/ogg", "tone.opus"),
            ("clip.mp4", "video/mp4", ""),
        ] {
            let machine = FileMachine(path: "/files/\(name)", data: try fixture(name), mime: mime)
            let opened = try await open(machine, name: name) { view in
                let labels = NativePresentationProbe.labels(in: view)
                if mime.hasPrefix("video/") {
                    return self.playerController(in: view.window?.rootViewController)?.player?.currentItem?.status
                        == .readyToPlay
                }
                return labels.contains("Play") && labels.contains("Position") && labels.contains(title)
            }
            XCTAssertTrue(opened, name)
            XCTAssertGreaterThan(machine.pieces, 0, name)
        }
    }

    @MainActor func testAFileTheMachineDoesNotServeAsksForNoBytes() async throws {
        let machine = FileMachine(
            path: "/files/archive.zip", data: try fixture("archive.zip"), mime: "application/octet-stream")
        let opened = try await open(machine, name: "archive.zip") { view in
            NativePresentationProbe.labels(in: view).contains {
                $0.contains("The machine only sends images, video, sound and PDFs to this app.")
            }
        }
        XCTAssertTrue(opened)
        XCTAssertGreaterThan(machine.reads, 0)
        XCTAssertEqual(machine.pieces, 0)
    }

    @MainActor func testAPictureThatDoesNotDecodeFallsBackToQuickLook() async throws {
        let machine = FileMachine(path: "/files/broken.png", data: Data("not a picture".utf8), mime: "image/png")
        let fallback = try await open(machine, name: "broken.png") { view in
            let labels = NativePresentationProbe.labels(in: view)
            return view.descendant(of: ZoomingImageView.self) == nil
                && labels.contains("Quick Look") && labels.contains("Share")
        }
        XCTAssertTrue(fallback)
        // One read for the picture, one for the file Quick Look and Share get.
        XCTAssertEqual(machine.pieces, 2)
    }

    @MainActor func testSourceIsColoredInTheLanguageTheMachineNames() async throws {
        let machine = FileMachine(
            path: "/files/main.ts", data: Data("export const answer: number = 42;\n".utf8), mime: "text/plain",
            language: "typescript")
        var colored = false
        let opened = try await open(machine, name: "main.ts") { view in
            let ready =
                NativePresentationProbe.contains("code.highlighted", in: view)
                && NativePresentationProbe.labels(in: view).contains {
                    $0.contains("export const answer: number = 42;")
                }
            if ready { colored = self.hasSyntaxColor(in: view) }
            return ready
        }
        XCTAssertTrue(opened)
        XCTAssertTrue(colored, "The native code text must retain the highlighter's colors")
        XCTAssertGreaterThan(machine.reads, 0)
    }

    @MainActor private func hasSyntaxColor(in view: UIView) -> Bool {
        guard
            let code = NativePresentationProbe.elements(in: view).first(where: {
                $0.responds(to: NSSelectorFromString("accessibilityIdentifier"))
                    && ($0.value(forKey: "accessibilityIdentifier") as? String) == "code.highlighted"
            })
        else { return false }
        let rectangle = view.convert(code.accessibilityFrame, from: nil).intersection(view.bounds)
        guard !rectangle.isEmpty else { return false }
        let image = UIGraphicsImageRenderer(size: rectangle.size).image { context in
            context.cgContext.translateBy(x: -rectangle.minX, y: -rectangle.minY)
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        guard let pixels = image.cgImage else { return false }
        var rgba = [UInt8](repeating: 0, count: pixels.width * pixels.height * 4)
        let drawn = rgba.withUnsafeMutableBytes { buffer in
            guard
                let context = CGContext(
                    data: buffer.baseAddress, width: pixels.width, height: pixels.height, bitsPerComponent: 8,
                    bytesPerRow: pixels.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(pixels, in: CGRect(x: 0, y: 0, width: pixels.width, height: pixels.height))
            return true
        }
        guard drawn else { return false }
        // Only the code text is cropped; neutral text on its neutral panel cannot satisfy this.
        return stride(from: 0, to: rgba.count, by: 4).contains { offset in
            let channels = rgba[offset...offset + 2]
            return Int(channels.max()!) - Int(channels.min()!) > 40
        }
    }

    /// Opens the page for `machine` and waits until `ready` holds or `frames` pass, then keeps a picture of it.
    @MainActor private func open(
        _ machine: FileMachine, name: String, frames: Int = 300, ready: @escaping (UIView) -> Bool
    ) async throws -> Bool {
        try NativePresentationProbe.enableAccessibility()
        let host = UIHostingController(
            rootView: NavigationStack { FileContentPage(client: machine, path: machine.path) })
        let window = UIWindow.showing(host, size: CGSize(width: 402, height: 874))
        defer { window.close() }
        var found = false
        for _ in 0..<frames {
            await displayFrames()
            if ready(host.view) {
                found = true
                break
            }
        }
        await displayFrames(10)
        capture(window, name: "file-\(name)")
        return found
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(
                forResource: (name as NSString).deletingPathExtension,
                withExtension: (name as NSString).pathExtension), name)
        return try Data(contentsOf: url)
    }

    @MainActor private func playerController(in controller: UIViewController?) -> AVPlayerViewController? {
        if let player = controller as? AVPlayerViewController { return player }
        for child in controller?.children ?? [] {
            if let player = playerController(in: child) { return player }
        }
        return nil
    }
}

/// Answers `fs.read` and `bytes.read` for one file the way a machine does, and counts the pieces it sent.
@MainActor private final class FileMachine: MachineRequesting {
    let path: String
    let data: Data
    let mime: String
    let language: String?
    private(set) var pieces = 0
    private(set) var reads = 0

    init(path: String, data: Data, mime: String, language: String? = nil) {
        self.path = path
        self.data = data
        self.mime = mime
        self.language = language
    }

    func request(_ type: WireRequest, payload: JSONValue) async throws -> JSONValue {
        switch type {
        case .fsRead:
            reads += 1
            if let language {
                return .object([
                    "kind": .string("text"), "text": .string(String(decoding: data, as: UTF8.self)),
                    "encoding": .string("utf-8"), "size": .number(Double(data.count)), "mtime": .number(1),
                    "language": .string(language),
                ])
            }
            return .object([
                "kind": .string("binary"), "mime": .string(mime), "size": .number(Double(data.count)),
                "mtime": .number(1),
            ])
        case .bytesRead:
            let offset = Int(payload["offset"]?.numberValue ?? 0)
            let length = Int(payload["length"]?.numberValue ?? 0)
            if offset == 0 { pieces += 1 }
            let slice = data.subdata(in: min(offset, data.count)..<min(offset + length, data.count))
            return .object([
                "mime": .string(mime), "size": .number(Double(data.count)), "version": .string("1-\(data.count)"),
                "offset": .number(Double(offset)), "data": .string(slice.base64EncodedString()),
            ])
        default:
            return .object([:])
        }
    }

    func subscribe(_ event: WireEvent, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
