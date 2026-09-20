import RuimtePulsar
import RuimteTransport
import UIKit
import XCTest

@testable import Ruimte

final class ProjectArtworkTests: XCTestCase {
    func testImageRequestUsesProjectResourceAndSeparatesIdentityThemeAndVersion() throws {
        let light = try request()
        XCTAssertEqual(
            light.resource,
            .object([
                "kind": .string("projectIcon"), "projectId": .string("project"), "theme": .string("light"),
            ]))
        XCTAssertNotEqual(light, try request(dark: true))
        XCTAssertNotEqual(light, try request(version: "new"))
        XCTAssertNotEqual(light, try request(key: "replacement-machine-key"))
        XCTAssertNil(
            ProjectArtworkRequest(
                machineID: "machine", publicKey: "key",
                project: .object([
                    "projectId": .string("project"),
                    "icon": .object(["kind": .string("lucide"), "value": .string("rocket")]),
                ]), dark: false))
    }

    @MainActor func testRasterLoadingUsesBoundedMachineResourceAndCachesImage() async throws {
        let data = UIGraphicsImageRenderer(size: CGSize(width: 512, height: 256)).pngData { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 512, height: 256))
        }
        let client = ArtworkMachine(data: data)
        let loader = ProjectArtworkLoader()
        let descriptor = try request()
        let first = try await loader.load(descriptor, client: client)
        let second = try await loader.load(descriptor, client: client)
        XCTAssertTrue(first === second)
        XCTAssertEqual(client.requests.count, 1)
        XCTAssertEqual(client.requests.first?["resource"], descriptor.resource)
        XCTAssertEqual(first.cgImage?.width, 128)
        XCTAssertEqual(first.cgImage?.height, 64)
        XCTAssertNil(ProjectArtworkLoader.thumbnail(Data(repeating: 0, count: ProjectArtworkLoader.maximumBytes + 1)))
    }

    @MainActor func testSVGRendersOriginalColorsIntoNativeImage() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = UIViewController()
        window.rootViewController?.view.backgroundColor = .white
        window.makeKeyAndVisible()
        window.layoutIfNeeded()
        XCTAssertGreaterThan(window.safeAreaInsets.top, 0, "Exercise the phone's real top safe area")
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }
        let data = Data(
            ##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop stop-color="#0000ff"/><stop offset="1" stop-color="#00ffff"/></linearGradient></defs><path fill="#ff0000" d="M0 0h50v100H0z"/><path fill="url(#g)" d="M50 0h50v100H50z"/></svg>"##
                .utf8)
        let result = try await ProjectSVGRasterizer().render(data)
        let image = try XCTUnwrap(result.cgImage)
        let left = try pixel(image, x: image.width / 4, y: image.height / 2)
        let right = try pixel(image, x: image.width * 3 / 4, y: image.height / 2)
        XCTAssertGreaterThan(left[0], 230)
        XCTAssertLessThan(left[1], 25)
        XCTAssertLessThan(left[2], 25)
        XCTAssertGreaterThan(right[2], 230)
        XCTAssertLessThan(right[0], 25)
        XCTAssertGreaterThan(right[1], 60)
        for y in [2, image.height - 3] {
            let topOrBottom = try pixel(image, x: image.width / 4, y: y)
            XCTAssertGreaterThan(
                topOrBottom[0], 230, "The SVG must reach both vertical edges without a safe-area offset")
            XCTAssertGreaterThan(topOrBottom[3], 230)
        }
        let attachment = XCTAttachment(image: result)
        attachment.name = "project-artwork-svg"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor func testSVGDocumentIsolatesUntrustedMarkup() {
        let hostile = Data(#"</img><script>fetch('https://example.invalid')</script><svg/>"#.utf8)
        let document = ProjectSVGRasterizer.document(hostile)
        XCTAssertFalse(document.contains("<script>"))
        XCTAssertFalse(document.contains("https://example.invalid"))
        XCTAssertTrue(document.contains("default-src 'none'; img-src data:"))
        XCTAssertTrue(document.contains(hostile.base64EncodedString()))
    }

    private func request(dark: Bool = false, version: String = "v1", key: String = "key") throws
        -> ProjectArtworkRequest
    {
        try XCTUnwrap(
            ProjectArtworkRequest(
                machineID: "machine", publicKey: key,
                project: .object([
                    "projectId": .string("project"),
                    "icon": .object([
                        "kind": .string("image"), "value": .string("https://untrusted.invalid/../../secret.svg"),
                        "version": .string(version),
                    ]),
                ]), dark: dark))
    }

    private func pixel(_ image: CGImage, x: Int, y: Int) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        try bytes.withUnsafeMutableBytes { storage in
            let context = try XCTUnwrap(
                CGContext(
                    data: storage.baseAddress, width: image.width, height: image.height,
                    bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        let offset = (y * image.width + x) * 4
        return Array(bytes[offset..<offset + 4])
    }
}

@MainActor private final class ArtworkMachine: MachineRequesting {
    let data: Data
    var requests: [JSONValue] = []
    init(data: Data) { self.data = data }
    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        XCTAssertEqual(type, "bytes.read")
        requests.append(payload)
        return .object([
            "mime": .string("image/png"), "size": .number(Double(data.count)), "version": .string("v1"),
            "offset": .number(0), "data": .string(data.base64EncodedString()),
        ])
    }
    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
