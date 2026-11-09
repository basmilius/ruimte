import CoreTransferable
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// An image of a chat as the lightbox pages through it: an attachment, or a file on the machine.
struct ChatLightboxImage: Identifiable {
    let resource: JSONValue
    let name: String
    var mime: String? = nil

    var id: String {
        resource["attachmentId"]?.stringValue ?? resource["path"]?.stringValue ?? name
    }
}

/// Where the thumbnails of a lightbox stand on screen and what they show, so the picture flies out of the one it
/// opened from and back into whichever one the person ended on.
@Observable
final class ChatLightboxSources {
    /// The thumbnail the lightbox stands in for, hidden so the picture is in one place at a time.
    var hidden: String?
    @ObservationIgnored var frames: [String: CGRect] = [:]
    @ObservationIgnored var thumbnails: [String: UIImage] = [:]
}

/// The images that open together, in the order a swipe walks them, and where their thumbnails are.
struct ChatImageGroup {
    let images: [ChatLightboxImage]
    let sources: ChatLightboxSources
}

extension EnvironmentValues {
    @Entry var chatImageGroup: ChatImageGroup?
}

/// Thumbnails inside open one lightbox together.
struct ChatImageGroupScope<Content: View>: View {
    let images: [ChatLightboxImage]
    @ViewBuilder let content: Content
    @State private var sources = ChatLightboxSources()

    var body: some View {
        content.environment(\.chatImageGroup, images.count > 1 ? ChatImageGroup(images: images, sources: sources) : nil)
    }
}

extension View {
    /// Marks a thumbnail as the place its picture flies from and back to.
    func chatLightboxSource(_ id: String, image: UIImage?, in sources: ChatLightboxSources) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { sources.frames[id] = $0 }
            .onAppear { sources.thumbnails[id] = image }
            .onChange(of: image) { _, image in sources.thumbnails[id] = image }
            .opacity(sources.hidden == id ? 0 : 1)
    }

    /// The lightbox over everything, presented without the system's own animation so it can run its own.
    func chatLightbox(_ start: Binding<ChatLightboxStart?>, client: (any MachineRequesting)?) -> some View {
        fullScreenCover(item: start) { opened in
            if let client {
                ChatLightbox(client: client, start: opened) {
                    var transaction = Transaction()
                    transaction.disablesAnimations = true
                    withTransaction(transaction) { start.wrappedValue = nil }
                }
                .presentationBackground(.clear)
            }
        }
    }
}

struct ChatLightboxStart: Identifiable {
    let images: [ChatLightboxImage]
    let index: Int
    /// The picture the thumbnail already holds, which flies out while the full bytes load.
    let placeholder: UIImage
    let sources: ChatLightboxSources
    /// The corner of the thumbnails, which the picture rounds into on its way back.
    var radius: CGFloat = 10

    var id: String { images[index].id }

    /// Opens without the system's animation, which would slide the lightbox up before its own flight.
    static func open(_ start: ChatLightboxStart, into binding: Binding<ChatLightboxStart?>) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { binding.wrappedValue = start }
    }
}

/// A drag of a picture at rest, from the page's own pan so it never fights the zoom or the paging.
enum ChatLightboxDrag {
    case changed(translation: CGSize)
    case ended(translation: CGSize, velocity: CGSize)
}

private enum LightboxPhase {
    /// The picture in flight or under a finger, drawn by the lightbox itself over the pages.
    case flying
    /// The pages show, with their own zoom and scrolling.
    case shown
}

/// Images over the whole screen, the way Photos shows them: the picture flies out of its thumbnail, a pinch or a
/// double tap zooms, a swipe sideways walks the group, a swipe up or down carries it back, and a tap hides the
/// controls.
struct ChatLightbox: View {
    let client: any MachineRequesting
    let start: ChatLightboxStart
    let onClose: () -> Void
    @State private var selection: String
    @State private var chrome = true
    @State private var phase = LightboxPhase.flying
    @State private var started = false
    @State private var opened = false
    @State private var dragging = false
    @State private var closing = false
    @State private var screen = CGSize.zero
    @State private var flight = CGRect.zero
    @State private var radius: CGFloat
    @State private var backdrop = 0.0
    @State private var flightOpacity = 1.0
    @State private var loaded: [String: UIImage] = [:]

    private static let spring = Animation.spring(duration: 0.38, bounce: 0.12)

    init(client: any MachineRequesting, start: ChatLightboxStart, onClose: @escaping () -> Void) {
        self.client = client
        self.start = start
        self.onClose = onClose
        _selection = State(initialValue: start.id)
        _radius = State(initialValue: start.radius)
        _flight = State(initialValue: start.sources.frames[start.id] ?? .zero)
    }

    private static let controlsFade = Animation.easeOut(duration: 0.2)

    /// The controls fade on their own clock: in while the picture lands, out as soon as a drag or a close starts.
    private var controlsShown: Bool { chrome && opened && !dragging && !closing }

    private var images: [ChatLightboxImage] { start.images }
    private var index: Int { images.firstIndex { $0.id == selection } ?? 0 }
    private var current: ChatLightboxImage { images[index] }

    /// What the current page shows, which is also what flies.
    private var picture: UIImage? {
        loaded[selection] ?? (selection == start.id ? start.placeholder : start.sources.thumbnails[selection])
    }

    var body: some View {
        ZStack {
            Color.black.opacity(backdrop).ignoresSafeArea()
            TabView(selection: $selection) {
                ForEach(images) { image in
                    ChatLightboxPage(
                        client: client, image: image,
                        placeholder: image.id == start.id ? start.placeholder : start.sources.thumbnails[image.id],
                        active: image.id == selection,
                        onTap: { withAnimation(.easeOut(duration: 0.2)) { chrome.toggle() } },
                        onLoaded: { loaded[image.id] = $0 },
                        onDrag: drag
                    )
                    // A page lays out inside the safe area of its own, which would center the picture below the
                    // middle of the screen the flight lands in.
                    .ignoresSafeArea()
                    .tag(image.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            .opacity(phase == .shown ? 1 : 0)
            .allowsHitTesting(!closing)
            // The flight's own layer covers the whole screen, so its size, its origin and the thumbnails' global
            // frames are the same coordinates as the pages.
            ZStack(alignment: .topLeading) {
                Color.clear.onGeometryChange(for: CGSize.self) { $0.size } action: { screen = $0 }
                if phase == .flying, let picture {
                    Image(uiImage: picture).resizable().aspectRatio(contentMode: .fill)
                        .frame(width: flight.width, height: flight.height)
                        .clipShape(RoundedRectangle(cornerRadius: radius))
                        .offset(x: flight.minX, y: flight.minY)
                        .opacity(flightOpacity)
                }
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .overlay(alignment: .top) {
            bar.opacity(controlsShown ? 1 : 0).offset(y: controlsShown ? 0 : -8).allowsHitTesting(controlsShown)
        }
        .overlay(alignment: .bottom) {
            caption.opacity(controlsShown ? 1 : 0).offset(y: controlsShown ? 0 : 8).allowsHitTesting(controlsShown)
        }
        .statusBarHidden(!controlsShown)
        .environment(\.colorScheme, .dark)
        .accessibilityAction(.escape) { close() }
        .onAppear(perform: open)
        .onChange(of: screen) { open() }
        .onChange(of: selection) { _, id in start.sources.hidden = id }
    }

    /// The whole screen the picture fits in, as the zooming page fits it: a small picture keeps one point per pixel.
    private func fitted(_ image: UIImage?) -> CGRect {
        guard let image, image.size.width > 0, image.size.height > 0, screen.width > 0 else {
            return CGRect(origin: .zero, size: screen)
        }
        let scale = min(screen.width / image.size.width, screen.height / image.size.height, 1)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return CGRect(
            x: (screen.width - size.width) / 2, y: (screen.height - size.height) / 2, width: size.width,
            height: size.height)
    }

    /// The first frame is drawn at the thumbnail; the flight starts once the screen is measured.
    private func open() {
        guard !started, screen != .zero else { return }
        started = true
        start.sources.hidden = start.id
        Task { @MainActor in
            withAnimation(Self.spring) {
                flight = fitted(picture)
                radius = 0
                backdrop = 1
            } completion: {
                phase = .shown
            }
            withAnimation(Self.controlsFade.delay(0.12)) { opened = true }
        }
    }

    private func close() {
        guard !closing else { return }
        withAnimation(Self.controlsFade) { closing = true }
        if phase == .shown { flight = fitted(picture) }
        phase = .flying
        let bounds = CGRect(origin: .zero, size: screen)
        let target = start.sources.frames[selection].flatMap { bounds.intersects($0) ? $0 : nil }
        withAnimation(Self.spring) {
            backdrop = 0
            if let target {
                flight = target
                radius = start.radius
            } else {
                flightOpacity = 0
            }
        } completion: {
            start.sources.hidden = nil
            onClose()
        }
    }

    /// A drag up or down on a picture at rest carries it, smaller as it goes, and lets go of it past a short way or a flick.
    private func drag(_ state: ChatLightboxDrag) {
        guard !closing else { return }
        let rest = fitted(picture)
        switch state {
        case .changed(let translation):
            phase = .flying
            if !dragging { withAnimation(Self.controlsFade) { dragging = true } }
            let distance = abs(translation.height)
            let scale = max(0.5, 1 - distance / max(screen.height, 1) * 0.6)
            flight = CGRect(
                x: rest.midX + translation.width - rest.width * scale / 2,
                y: rest.midY + translation.height - rest.height * scale / 2, width: rest.width * scale,
                height: rest.height * scale)
            backdrop = max(0, 1 - distance / 300)
        case .ended(let translation, let velocity):
            if abs(translation.height) > 100 || abs(velocity.height) > 800 {
                close()
                return
            }
            withAnimation(Self.spring) {
                flight = rest
                backdrop = 1
            } completion: {
                if !closing { phase = .shown }
            }
            withAnimation(Self.controlsFade.delay(0.12)) { dragging = false }
        }
    }

    private var bar: some View {
        HStack {
            Button {
                close()
            } label: {
                Image(lucide: "x", size: 16).frame(width: 44, height: 44)
            }
            .buttonStyle(MobileGlassButtonStyle(shape: .circle))
            .accessibilityLabel(String(localized: "Close"))
            Spacer(minLength: 0)
            ShareLink(
                item: ChatImageFile(
                    name: current.name, type: current.mime.flatMap { UTType(mimeType: $0) },
                    data: { [client, resource = current.resource] in try await client.readResource(resource).data }),
                preview: SharePreview(current.name)
            ) {
                Image(lucide: "share", size: 16).frame(width: 44, height: 44)
            }
            .buttonStyle(MobileGlassButtonStyle(shape: .circle))
            .accessibilityLabel(String(localized: "Share"))
        }
        .foregroundStyle(MobileStyle.text)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var caption: some View {
        VStack(spacing: 2) {
            Text(verbatim: current.name).font(.footnote.weight(.medium)).lineLimit(1).truncationMode(.middle)
            if images.count > 1 {
                Text("\(index + 1) of \(images.count)").font(.caption).foregroundStyle(MobileStyle.muted)
                    .monospacedDigit()
            }
        }
        .foregroundStyle(MobileStyle.text)
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
    }
}

/// One image of the lightbox, read whole from the machine when its page comes up.
private struct ChatLightboxPage: View {
    let client: any MachineRequesting
    let image: ChatLightboxImage
    let placeholder: UIImage?
    let active: Bool
    let onTap: () -> Void
    let onLoaded: (UIImage) -> Void
    let onDrag: (ChatLightboxDrag) -> Void
    @State private var full: UIImage?
    @State private var failure: String?

    var body: some View {
        ZStack {
            if let picture = full ?? placeholder {
                FileImageView(image: picture, name: image.name, active: active, onTap: onTap, onDrag: onDrag)
            } else if let failure {
                VStack(spacing: 8) {
                    Image(lucide: "image-off", size: 24).foregroundStyle(MobileStyle.faint)
                    Text(verbatim: failure).font(.footnote).foregroundStyle(MobileStyle.muted)
                        .multilineTextAlignment(.center)
                }
                .padding(32)
            } else {
                Spinner(size: 20).foregroundStyle(MobileStyle.faint)
                    .accessibilityLabel(String(localized: "Loading image"))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { if full == nil && placeholder == nil { onTap() } }
        .task(id: image.id) {
            guard full == nil else { return }
            do {
                let bytes = try await client.readResource(image.resource)
                try Task.checkCancellation()
                let decoded = await Task.detached(priority: .userInitiated) { FileImage.decode(bytes.data) }.value
                try Task.checkCancellation()
                if let decoded {
                    full = decoded.image
                    onLoaded(decoded.image)
                } else {
                    failure = String(localized: "The image is not available")
                }
            } catch is CancellationError {} catch {
                failure = error.localizedDescription
            }
        }
    }
}

/// An image as a file for the share sheet, in the type the attachment says it is, so Save Image and other apps
/// take it as that image.
struct ChatImageFile: Transferable {
    let name: String
    let type: UTType?
    /// Read only once the person picks where the image goes.
    let data: @Sendable @MainActor () async throws -> Data

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { try await $0.data() }
            .exportingCondition { $0.type == .png || $0.type == nil }
            .suggestedFileName { $0.name }
        DataRepresentation(exportedContentType: .jpeg) { try await $0.data() }
            .exportingCondition { $0.type == .jpeg }
            .suggestedFileName { $0.name }
        DataRepresentation(exportedContentType: .webP) { try await $0.data() }
            .exportingCondition { $0.type == .webP }
            .suggestedFileName { $0.name }
        DataRepresentation(exportedContentType: .image) { try await $0.data() }
            .exportingCondition { ![UTType.png, .jpeg, .webP].contains($0.type ?? .png) }
            .suggestedFileName { $0.name }
    }
}
