import ImageIO
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct ProjectArtwork: View {
    let session: SharedMachineSession
    let project: JSONValue
    var size: CGFloat = 42
    @Environment(\.colorScheme) private var colorScheme
    @State private var image: UIImage?

    private var request: ProjectArtworkRequest? {
        ProjectArtworkRequest(
            machineID: session.machine.id, publicKey: session.machine.publicKey,
            project: project, dark: colorScheme == .dark)
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).renderingMode(.original).resizable().scaledToFit().padding(4)
            } else if project["icon"]?.text("kind") == "emoji" {
                Text(project["icon"]?.text("value") ?? "").font(.system(size: (size * 0.65).rounded()))
            } else if project["icon"]?.text("kind") == "lucide" {
                LucideIcon(name: project["icon"]?.text("value") ?? "folder", size: (size * 0.55).rounded())
                    .foregroundStyle(MobileStyle.accent)
            } else {
                Text(String(project.text("name", fallback: "Project").prefix(1)).uppercased())
                    .font(.system(size: (size * 0.48).rounded(), weight: .semibold)).foregroundStyle(MobileStyle.accent)
            }
        }
        .frame(width: size, height: size)
        .background(MobileStyle.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: (size * 0.26).rounded()))
        .accessibilityHidden(true)
        .task(id: ProjectArtworkLoadID(request: request, generation: session.generation, connected: session.connected))
        {
            image = request.flatMap { ProjectArtworkLoader.shared.cached($0) }
            guard let request, session.connected else { return }
            do {
                let loaded = try await ProjectArtworkLoader.shared.load(request, client: session.rpc)
                try Task.checkCancellation()
                image = loaded
            } catch {}
        }
    }
}

private struct ProjectArtworkLoadID: Hashable {
    let request: ProjectArtworkRequest?
    let generation: Int
    let connected: Bool
}

struct ProjectArtworkRequest: Hashable {
    let machineID: String
    let publicKey: String
    let projectID: String
    let version: String
    let dark: Bool

    init?(machineID: String, publicKey: String, project: JSONValue, dark: Bool) {
        guard project["icon"]?.text("kind") == "image",
            let version = project["icon"]?["version"]?.stringValue, !version.isEmpty,
            let projectID = project["projectId"]?.stringValue, !projectID.isEmpty
        else { return nil }
        self.machineID = machineID
        self.publicKey = publicKey
        self.projectID = projectID
        self.version = version
        self.dark = dark
    }

    var resource: JSONValue {
        .object([
            "kind": .string("projectIcon"), "projectId": .string(projectID), "theme": .string(dark ? "dark" : "light"),
        ])
    }
}

@MainActor
final class ProjectArtworkLoader {
    static let shared = ProjectArtworkLoader()
    static let maximumBytes = 256 * 1024
    private var images: [ProjectArtworkRequest: UIImage] = [:]
    private var recency: [ProjectArtworkRequest] = []
    private var loading: [ProjectArtworkRequest: Task<UIImage, Error>] = [:]
    private let svg = ProjectSVGRasterizer()

    func cached(_ request: ProjectArtworkRequest) -> UIImage? { images[request] }

    func load(_ request: ProjectArtworkRequest, client: any MachineRequesting) async throws -> UIImage {
        if let image = images[request] { return image }
        if let task = loading[request] { return try await task.value }
        let task = Task {
            let resource = try await client.readResource(request.resource, maxBytes: Self.maximumBytes)
            let mime = resource.mime.split(separator: ";", maxSplits: 1).first?.lowercased() ?? ""
            if mime == "image/svg+xml" { return try await svg.render(resource.data) }
            guard mime.hasPrefix("image/"), let image = Self.thumbnail(resource.data) else {
                throw ProjectArtworkError.invalidImage
            }
            return image
        }
        loading[request] = task
        defer { loading[request] = nil }
        let image = try await task.value
        images[request] = image
        recency.removeAll { $0 == request }
        recency.append(request)
        while recency.count > 96 { images.removeValue(forKey: recency.removeFirst()) }
        return image
    }

    static func thumbnail(_ data: Data) -> UIImage? {
        guard !data.isEmpty, data.count <= maximumBytes,
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let image = CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: 128,
                    kCGImageSourceShouldCacheImmediately: true,
                ] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: image)
    }
}

enum ProjectArtworkError: Error { case invalidImage, unavailable, timedOut }
