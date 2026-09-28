import AVFoundation
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

    func testTheMachinesLanguageIsTranslatedOnlyWhereHighlightJSNamesItOtherwise() {
        XCTAssertEqual(FileKinds.highlightLanguage("typescript"), "typescript")
        XCTAssertEqual(FileKinds.highlightLanguage("tsx"), "tsx")
        XCTAssertEqual(FileKinds.highlightLanguage("vue"), "xml")
        XCTAssertEqual(FileKinds.highlightLanguage("shellscript"), "bash")
        XCTAssertEqual(FileKinds.highlightLanguage("dotenv"), "bash")
        XCTAssertEqual(FileKinds.highlightLanguage("jsonc"), "jsonc")
        XCTAssertEqual(FileKinds.highlightLanguage("ignore"), "plaintext")
        XCTAssertEqual(FileKinds.highlightLanguage(nil), "plaintext")
        XCTAssertEqual(FileKinds.highlightLanguage(""), "plaintext")
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
                guard let zooming = self.descendant(ZoomingImageView.self, in: view) else { return false }
                return zooming.imageView.image != nil && zooming.maximumZoomScale > zooming.minimumZoomScale
            }
            XCTAssertTrue(opened, name)
        }
    }

    @MainActor func testAPDFOpensInPDFKit() async throws {
        let machine = FileMachine(
            path: "/files/document.pdf", data: try fixture("document.pdf"), mime: "application/pdf")
        let opened = try await open(machine, name: "document.pdf") { view in
            self.descendant(PDFView.self, in: view)?.document?.pageCount == 2
        }
        XCTAssertTrue(opened)
    }

    @MainActor func testSoundAndVideoOpenInTheirPlayers() async throws {
        for (name, mime) in [
            ("tone.mp3", "audio/mpeg"), ("tone.m4a", "audio/mp4"), ("tone.aac", "audio/aac"),
            ("tone.wav", "audio/wav"), ("tone.flac", "audio/flac"), ("tone.opus", "audio/ogg"),
            ("clip.mp4", "video/mp4"),
        ] {
            let machine = FileMachine(path: "/files/\(name)", data: try fixture(name), mime: mime)
            _ = try await open(machine, name: name, frames: 120) { _ in false }
            XCTAssertGreaterThan(machine.pieces, 0, name)
        }
    }

    @MainActor func testAFileTheMachineDoesNotServeAsksForNoBytes() async throws {
        let machine = FileMachine(
            path: "/files/archive.zip", data: try fixture("archive.zip"), mime: "application/octet-stream")
        _ = try await open(machine, name: "archive.zip", frames: 60) { _ in false }
        XCTAssertEqual(machine.pieces, 0)
    }

    @MainActor func testAPictureThatDoesNotDecodeFallsBackToQuickLook() async throws {
        let machine = FileMachine(path: "/files/broken.png", data: Data("not a picture".utf8), mime: "image/png")
        let drawn = try await open(machine, name: "broken.png", frames: 60) { view in
            self.descendant(ZoomingImageView.self, in: view) != nil
        }
        XCTAssertFalse(drawn)
        // One read for the picture, one for the file Quick Look and Share get.
        XCTAssertEqual(machine.pieces, 2)
    }

    @MainActor func testSourceIsColoredInTheLanguageTheMachineNames() async throws {
        let machine = FileMachine(
            path: "/files/main.ts", data: Data("export const answer: number = 42;\n".utf8), mime: "text/plain",
            language: "typescript")
        _ = try await open(machine, name: "main.ts", frames: 60) { _ in false }
    }

    /// Opens the page for `machine` and waits until `ready` holds or `frames` pass, then keeps a picture of it.
    @MainActor private func open(
        _ machine: FileMachine, name: String, frames: Int = 300, ready: @escaping (UIView) -> Bool
    ) async throws -> Bool {
        let host = UIHostingController(
            rootView: NavigationStack { FileContentPage(client: machine, path: machine.path) })
        let window = makeWindow(host, size: CGSize(width: 402, height: 874))
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }
        var found = false
        for _ in 0..<frames {
            await displayFrame()
            if ready(host.view) {
                found = true
                break
            }
        }
        for _ in 0..<10 { await displayFrame() }
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

    @MainActor private func descendant<ViewType: UIView>(_ type: ViewType.Type, in view: UIView) -> ViewType? {
        if let found = view as? ViewType { return found }
        for child in view.subviews {
            if let found = descendant(type, in: child) { return found }
        }
        return nil
    }

    @MainActor private func makeWindow(_ host: UIViewController, size: CGSize) -> UIWindow {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            fatalError("Visual tests require an active window scene")
        }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = host
        window.windowLevel = .alert + 1
        window.makeKeyAndVisible()
        return window
    }

    @MainActor private func capture(_ window: UIWindow, name: String) {
        window.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor private func displayFrame() async {
        await withCheckedContinuation { continuation in
            _ = FilePreviewFrame { continuation.resume() }
        }
    }
}

/// Answers `fs.read` and `bytes.read` for one file the way a machine does, and counts the pieces it sent.
@MainActor private final class FileMachine: MachineRequesting {
    let path: String
    let data: Data
    let mime: String
    let language: String?
    private(set) var pieces = 0

    init(path: String, data: Data, mime: String, language: String? = nil) {
        self.path = path
        self.data = data
        self.mime = mime
        self.language = language
    }

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        switch type {
        case "fs.read":
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
        case "bytes.read":
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

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}

@MainActor private final class FilePreviewFrame: NSObject {
    private var link: CADisplayLink?
    private var completion: (() -> Void)?

    init(completion: @escaping () -> Void) {
        self.completion = completion
        super.init()
        let link = CADisplayLink(target: self, selector: #selector(frame))
        self.link = link
        link.add(to: .main, forMode: .common)
    }

    @objc private func frame() {
        link?.invalidate()
        link = nil
        completion?()
        completion = nil
    }
}
