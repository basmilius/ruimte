import Foundation
import RuimteIntelligentUI
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers

struct ChatContentContext {
    let client: any MachineRequesting
    let chatID: String
    let cwd: String
    var workspace: MobileWorkspace? = nil
    var connected = false
    var scopeID: String? = nil
    /// What a person pointed at with `#` in the thread.
    var referenced: [String] = []
}

/// What the views, nodes and chats of a thread stand for now, for the rows that draw them as chips.
struct ChatReferenceLookup {
    var items: [ChatReferable] = []
    var referenced: [String] = []
    /// False outside a project, where a reference cannot be told apart from one that left it.
    var known = false

    func item(_ id: String) -> ChatReferable? { items.first { $0.id == id } }
}

/// The references a run of text draws as chips: picked ones a user message spells, or, in a reply, every `#Name` of
/// the project.
struct ChatInlineReferences {
    var picked: [ChatDraftReference] = []
    var named = false
    var lookup = ChatReferenceLookup()
}

struct ChatUiModels {
    let scopeID: String
    let chatID: String
    let cache: UiBlockModelCache
    let imageSave: ImageSaveCoordinator
}

struct ChatImageSaveRouting: ViewModifier {
    let coordinator: ImageSaveCoordinator
    func body(content: Content) -> some View {
        content.mobileSheet(
            isPresented: Binding(
                get: { coordinator.current != nil },
                set: { if !$0 { coordinator.close() } })
        ) {
            if let model = coordinator.current {
                GeneratedImageSaveDialog(model: model)
            }
        }
    }
}

extension EnvironmentValues {
    @Entry var chatContent: ChatContentContext?
    @Entry var chatUiModels: ChatUiModels?
    @Entry var chatMentions: [String] = []
    @Entry var chatSkills: [String] = []
    @Entry var markdownReferences = ""
    @Entry var chatReferenceLookup = ChatReferenceLookup()
    /// Set by a user message: the references it picked, under the names they have now.
    @Entry var chatPickedReferences: [ChatDraftReference]? = nil
    /// Set by a reply, whose `#Name` for a view, node or chat of the project becomes a chip.
    @Entry var chatNamesReferences = false
    /// How far a table may scroll past the text column: the inset to the screen edge, where nothing clips it sooner.
    @Entry var markdownTableBleed: CGFloat = 0
}

struct ChatFileReference: Identifiable, Equatable {
    var id: String { "\(path):\(line ?? 0)" }
    let path: String
    let line: Int?

    static func parse(_ text: String, cwd: String, explicit: Bool = false) -> Self? {
        var path = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let internalLink = path.hasPrefix("ruimte-file:")
        let encodedLink = explicit || path.hasPrefix("file://")
        if internalLink {
            guard let components = URLComponents(string: path),
                let value = components.queryItems?.first(where: { $0.name == "path" })?.value
            else { return nil }
            path = value
        }
        if path.hasPrefix("file://") { path = String(path.dropFirst(7)) }
        guard !path.isEmpty, !path.hasPrefix("~"), !path.hasPrefix("//"), !path.hasPrefix("#"),
            path.range(of: #"^[a-zA-Z][a-zA-Z0-9+.-]*://"#, options: .regularExpression) == nil
        else { return nil }
        if encodedLink && !internalLink { path = path.removingPercentEncoding ?? path }
        var line: Int?
        if let range = path.range(of: #"(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$"#, options: .regularExpression) {
            let suffix = String(path[range])
            line = Int(suffix.drop(while: { !$0.isNumber }).prefix(while: \.isNumber))
            path = String(path[..<range.lowerBound])
        }
        guard !path.isEmpty, path != ".", path != "..", !path.contains("\n") else { return nil }
        let name = (path as NSString).lastPathComponent
        let ext = (name as NSString).pathExtension.lowercased()
        let extensions = [
            "swift", "ts", "tsx", "js", "jsx", "json", "md", "txt", "py", "rs", "go", "css", "html", "vue", "yml",
            "yaml", "toml", "sh", "sql", "xml", "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg", "pdf", "c", "h", "cpp",
            "kt", "java",
        ]
        guard
            explicit || path.hasPrefix("/") || extensions.contains(ext) || name.hasPrefix(".")
                || ["Dockerfile", "Makefile", "LICENSE", "README"].contains(name)
        else { return nil }
        guard path.hasPrefix("/") || !cwd.isEmpty else { return nil }
        let absolute = path.hasPrefix("/") ? path : (cwd as NSString).appendingPathComponent(path)
        return Self(path: (absolute as NSString).standardizingPath, line: line.flatMap { $0 > 0 ? $0 : nil })
    }

    static func url(_ text: String) -> URL? {
        var components = URLComponents()
        components.scheme = "ruimte-file"
        components.host = "open"
        components.queryItems = [URLQueryItem(name: "path", value: text)]
        return components.url
    }
}

struct ChatLinkRouting: ViewModifier {
    let context: ChatContentContext
    @State private var target: ChatFileReference?
    @State private var uiTarget: UiLinkDestination?
    @State private var conflictSession: GitConflictSession?
    func body(content: Content) -> some View {
        content
            .environment(\.chatContent, context)
            .environment(\.chatReferenceLookup, lookup)
            .environment(\.uiHost, host)
            .environment(
                \.openURL,
                OpenURLAction { url in
                    if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") { return .systemAction }
                    if let id = ChatReferables.id(from: url) {
                        guard let workspace = context.workspace,
                            let place = ChatReferables.destination(id, views: workspace.views)
                        else { return .discarded }
                        uiTarget = .node(viewID: place.viewID, nodeID: place.nodeID)
                        return .handled
                    }
                    if let scheme = url.scheme, !["file", "ruimte-file"].contains(scheme) { return .discarded }
                    if let reference = ChatFileReference.parse(url.absoluteString, cwd: context.cwd, explicit: true) {
                        target = reference
                        return .handled
                    }
                    return .discarded
                }
            )
            .mobileSheet(isPresented: $target.isPresent()) {
                if let target {
                    NavigationStack {
                        FileContentPage(client: context.client, path: target.path, initialLine: target.line)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button(role: .close) { self.target = nil }
                                }
                            }
                    }
                }
            }
            .mobileSheet(isPresented: $uiTarget.isPresent()) {
                if let uiTarget {
                    NavigationStack {
                        destination(uiTarget)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button(role: .close) { self.uiTarget = nil }
                                }
                            }
                    }
                }
            }
    }

    private var lookup: ChatReferenceLookup {
        guard let workspace = context.workspace else { return ChatReferenceLookup(referenced: context.referenced) }
        return ChatReferenceLookup(
            items: ChatReferables.project(views: workspace.views, chatID: context.chatID),
            referenced: context.referenced, known: true)
    }

    private var host: UiHost {
        var host = UiHost(projectID: context.workspace?.projectID, connected: context.connected)
        if context.workspace != nil {
            host.open = { destination in
                if case .diff(let cwd, _, _, true) = destination {
                    conflictSession = GitConflictSession(cwd: cwd)
                } else {
                    conflictSession = nil
                }
                uiTarget = destination
            }
        }
        return host
    }

    @ViewBuilder private func destination(_ target: UiLinkDestination) -> some View {
        switch target {
        case .file(let path, let line):
            FileContentPage(client: context.client, path: path, initialLine: line)
        case .diff(let cwd, let path, let staged, let conflicted):
            if conflicted, let conflictSession {
                GitConflictFilePage(client: context.client, session: conflictSession, path: path)
            } else {
                GitDiffPage(
                    client: context.client, target: GitDiffTarget(cwd: cwd, path: path, staged: staged, commit: nil))
            }
        case .commit(let cwd, let sha):
            GitDiffPage(client: context.client, target: GitDiffTarget(cwd: cwd, path: nil, staged: false, commit: sha))
        case .node(let viewID, let nodeID):
            if let workspace = context.workspace,
                let view = workspace.views.first(where: { $0.stableID == viewID }),
                let item = view.stableID == nodeID ? view : view.list("nodes").first(where: { $0.stableID == nodeID })
            {
                ProjectItemPage(workspace: workspace, item: item, showsProject: true, projectName: workspace.title)
            } else {
                ContentUnavailableView(String(localized: "This view was removed"), lucideIcon: "square-x")
            }
        }
    }
}

struct ChatInlineText: View {
    let text: String
    var streaming = false
    @Environment(\.chatContent) private var context
    @Environment(\.chatMentions) private var mentions
    @Environment(\.chatSkills) private var skills
    @Environment(\.markdownReferences) private var references
    @Environment(\.chatReferenceLookup) private var lookup
    @Environment(\.chatPickedReferences) private var picked
    @Environment(\.chatNamesReferences) private var namesReferences
    @Environment(\.font) private var font

    var body: some View { ChatFadingText(text: attributed, streaming: streaming) }

    private var attributed: AttributedString {
        ChatInlineMarks.marked(
            MarkdownInline.parse(text, references: references), font: font, mentions: mentions, skills: skills,
            cwd: context?.cwd,
            references: ChatInlineReferences(
                picked: picked ?? [], named: picked == nil && namesReferences, lookup: lookup))
    }
}

/// A span of a message drawn on a rounded ground of its own: inline code, or a file, skill or `#` reference.
struct ChatPill: Hashable, Sendable {
    enum Kind: Hashable, Sendable {
        case code
        case file(String)
        case skill
        /// A view, node or chat, by the Lucide mark its sidebar row wears.
        case reference(String)
    }

    let kind: Kind
    /// Tells two pills apart that touch, so each gets a ground of its own.
    let id: Int

    /// The mark drawn in place of the `@` or `$` the text still carries.
    var icon: String? {
        switch kind {
        case .code: nil
        case .file(let path): FileKinds.icon(name: path, kind: path.hasSuffix("/") ? "directory" : "file")
        case .skill: "zap"
        case .reference(let mark): mark
        }
    }

    var tint: Color {
        switch kind {
        case .code, .reference: MobileStyle.text
        case .file: MobileStyle.accent
        case .skill: MobileStyle.skill
        }
    }

    var isReference: Bool {
        if case .reference = kind { return true }
        return false
    }
}

enum ChatPillAttribute: AttributedStringKey {
    typealias Value = ChatPill
    static let name = "ruimte.chatPill"
}

enum ChatInlineMarks {
    /// Pads a pill on both sides. It never breaks, so the padding stays on the line of the text it pads.
    static let padding: Character = "\u{202F}"

    /// `source` with its inline code and the picked files and skills marked as pills, each padded on both sides.
    /// Inline code overrules a pick: `@a.ts` between backticks is code.
    static func marked(
        _ source: AttributedString, font: Font?, mentions: [String], skills: [String], cwd: String?,
        references: ChatInlineReferences = ChatInlineReferences()
    ) -> AttributedString {
        var value = source
        var pills: [(range: Range<Int>, kind: ChatPill.Kind, font: Font, link: URL?)] = []
        let codeFont = ChatInlineFonts.code(around: font)
        let codeRuns = value.runs[\.inlinePresentationIntent].filter { $0.0?.contains(.code) == true }.map(\.1)
        for range in codeRuns {
            value[range].swiftUI.font = codeFont
            let token = String(value[range].characters)
            if let cwd, ChatFileReference.parse(token, cwd: cwd) != nil {
                value[range].link = ChatFileReference.url(token)
            }
            pills.append((offsets(range, in: value), .code, codeFont, nil))
        }
        let plain = String(value.characters)
        let code = pills.map(\.range)
        // A link already leads somewhere of its own, so a reply's `#Name` inside one stays text.
        let links = value.runs[\.link].filter { $0.0 != nil }.map { offsets($0.1, in: value) }
        let chipFont = ChatInlineFonts.chip(around: font)
        let lookup = references.lookup
        var tokens = ChatDraftSyntax.tokens(
            in: plain, mentions: mentions, skills: skills, references: references.picked)
        if references.named {
            tokens += ChatReferables.namedRanges(in: plain, items: lookup.items, referenced: lookup.referenced)
        }
        for token in tokens {
            guard let range = Range(token.range, in: plain) else { continue }
            let lower = plain.distance(from: plain.startIndex, to: range.lowerBound)
            let span = lower..<(lower + plain[range].count)
            guard !code.contains(where: { $0.overlaps(span) }) else { continue }
            switch token.kind {
            case "#":
                guard !references.named || !links.contains(where: { $0.overlaps(span) }) else { continue }
                let mark = lookup.item(token.value)?.mark ?? ChatReferables.icon("text")
                pills.append((span, .reference(mark), chipFont, ChatReferables.url(token.value)))
            case "$": pills.append((span, .skill, chipFont, nil))
            default: pills.append((span, .file(token.value), chipFont, nil))
            }
        }
        for (id, pill) in pills.sorted(by: { $0.range.lowerBound < $1.range.lowerBound }).enumerated().reversed() {
            let mark = ChatPill(kind: pill.kind, id: id)
            let range = index(pill.range.lowerBound, in: value)..<index(pill.range.upperBound, in: value)
            value[range][ChatPillAttribute.self] = mark
            if mark.kind != .code {
                value[range].swiftUI.font = pill.font
                value[range].swiftUI.foregroundColor = mark.tint
            }
            if let link = pill.link { value[range].link = link }
            // In the proportional font, since a monospaced space is as wide as a letter.
            var pad = AttributedString(String(padding))
            pad.swiftUI.font = chipFont
            pad.swiftUI.kern = mark.kind == .code ? 2.5 : 3
            pad[ChatPillAttribute.self] = mark
            value.insert(pad, at: index(pill.range.upperBound, in: value))
            value.insert(pad, at: index(pill.range.lowerBound, in: value))
        }
        return value
    }

    private static func offsets(_ range: Range<AttributedString.Index>, in value: AttributedString) -> Range<Int> {
        let lower = value.characters.distance(from: value.startIndex, to: range.lowerBound)
        return lower..<(lower + value.characters.distance(from: range.lowerBound, to: range.upperBound))
    }

    private static func index(_ offset: Int, in value: AttributedString) -> AttributedString.Index {
        value.characters.index(value.startIndex, offsetBy: offset)
    }
}

/// The smaller text the desktop sets inline code and pills in, as the nearest Dynamic Type style: code at 13 against
/// text of 15, a pill at 12.
enum ChatInlineFonts {
    private static let sizes: [(style: Font.TextStyle, size: CGFloat)] = [
        (.caption2, 11), (.caption, 12), (.footnote, 13), (.subheadline, 15), (.callout, 16), (.body, 17),
        (.title3, 20), (.title2, 22), (.title, 28), (.largeTitle, 34),
    ]

    private static let known: [(font: Font, style: Font.TextStyle)] =
        [
            (.caption2, .caption2), (.caption, .caption), (.footnote, .footnote), (.subheadline, .subheadline),
            (.callout, .callout), (.body, .body), (.headline, .body), (.title3, .title3), (.title2, .title2),
            (.title, .title), (.largeTitle, .largeTitle),
        ] + (1...6).map { (MarkdownHeading.font($0), MarkdownHeading.style($0)) }

    /// The text style `font` is set in, or nil for a font of a fixed size.
    static func style(of font: Font?) -> Font.TextStyle? {
        guard let font else { return .body }
        return known.first { $0.font == font }?.style
    }

    static func smaller(_ style: Font.TextStyle, ratio: CGFloat) -> Font.TextStyle {
        let size = (sizes.first { $0.style == style }?.size ?? 17) * ratio
        return sizes.min { abs($0.size - size) < abs($1.size - size) }?.style ?? style
    }

    static func code(around font: Font?) -> Font {
        guard let style = style(of: font) else { return (font ?? .body).monospaced() }
        return .system(smaller(style, ratio: 13 / 15), design: .monospaced)
    }

    static func chip(around font: Font?) -> Font {
        guard let style = style(of: font) else { return (font ?? .body).weight(.medium) }
        return .system(smaller(style, ratio: 12 / 15), weight: .medium)
    }
}

struct ChatInlineImage: View {
    let resource: JSONValue
    let name: String
    /// A cell of a grid: a square the picture fills, rather than the picture at its own shape.
    var square = false
    @Environment(\.chatContent) private var context
    @Environment(\.chatImageGroup) private var group
    @State private var ownSources = ChatLightboxSources()
    @State private var image: UIImage?
    @State private var failure = false
    @State private var lightbox: ChatLightboxStart?

    private var lightboxImage: ChatLightboxImage { ChatLightboxImage(resource: resource, name: name) }

    /// The group this thumbnail stands in, when its picture is one of the group's.
    private var joined: ChatImageGroup? {
        let id = lightboxImage.id
        return group?.images.contains { $0.id == id } == true ? group : nil
    }

    var body: some View {
        Group {
            if let image {
                Button {
                    open(placeholder: image)
                } label: {
                    picture(image)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10).strokeBorder(MobileStyle.hairline)
                        }
                        .chatLightboxSource(lightboxImage.id, image: image, in: joined?.sources ?? ownSources)
                }.buttonStyle(.plain).accessibilityLabel("Preview \(name)")
            } else if failure {
                if square {
                    UiQuietSquare(text: name)
                } else {
                    Label(String(localized: "Image preview unavailable"), lucideIcon: "image", iconSize: 14)
                        .font(.caption).foregroundStyle(MobileStyle.muted)
                }
            } else if square {
                UiQuietSquare(text: nil).accessibilityLabel(String(localized: "Loading image"))
            } else {
                MobileLoadingRow(String(localized: "Loading image")).frame(width: 120, height: 80)
            }
        }
        .task(id: resource) {
            guard let context else {
                failure = true
                return
            }
            do {
                let bytes = try await context.client.readResource(resource)
                try Task.checkCancellation()
                let thumbnail = await Task.detached(priority: .utility) {
                    ChatThumbnail.image(bytes.data, maxPixel: 640)
                }.value
                try Task.checkCancellation()
                image = thumbnail.map { UIImage(cgImage: $0) }
                failure = image == nil
            } catch is CancellationError {} catch { failure = true }
        }
        .chatLightbox($lightbox, client: context?.client)
    }

    /// Opens the group this thumbnail stands in when it has one, at this picture, or this picture alone.
    private func open(placeholder: UIImage) {
        let own = lightboxImage
        let images = joined?.images ?? [own]
        let start = ChatLightboxStart(
            images: images, index: images.firstIndex { $0.id == own.id } ?? 0, placeholder: placeholder,
            sources: joined?.sources ?? ownSources)
        ChatLightboxStart.open(start, into: $lightbox)
    }

    @ViewBuilder private func picture(_ image: UIImage) -> some View {
        if square {
            Color.clear.aspectRatio(1, contentMode: .fit)
                .overlay { Image(uiImage: image).resizable().scaledToFill() }
        } else {
            // Exactly the picture's shape within 320 × 200, so the border and the flight to the lightbox hug the
            // picture instead of the box it would otherwise fit into.
            let aspect = image.size.width / max(image.size.height, 1)
            let width = min(320, 200 * aspect)
            Image(uiImage: image).resizable().frame(width: width, height: width / aspect)
        }
    }
}
