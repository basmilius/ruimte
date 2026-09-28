import ImageIO
import PhotosUI
import QuickLook
import RuimtePulsar
import SwiftUI
import UniformTypeIdentifiers

struct ChatComposerButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.55 : 1)
    }
}

struct ChatComposerView: View {
    @Bindable var model: ChatModel
    @Bindable var sheets: ChatComposerSheets
    @Binding var focused: Bool
    let availableHeight: CGFloat
    let send: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var photos: [PhotosPickerItem] = []
    @State private var preview: URL?
    @State private var expandedFocus = false
    @State private var pastedText: String?
    @AccessibilityFocusState private var editorAccessible: Bool

    private var maximumHeight: CGFloat { max(44, min(200, availableHeight * 0.3)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !model.composition.chats.isEmpty || !model.attachments.isEmpty || !model.composition.imports.isEmpty {
                contextStrip.padding(.top, 10)
            }
            HStack(alignment: .bottom, spacing: 6) {
                editor(maximumHeight: maximumHeight, focus: $focused)
                    .padding(.vertical, 15)
                    .accessibilityFocused($editorAccessible)
                sendButton.padding(.vertical, 6)
            }
            .padding(.leading, 20).padding(.trailing, 6)
        }
        .background {
            // Keep the focus gesture behind controls and UIKit's text selection gestures.
            Color.clear
                .contentShape(RoundedRectangle(cornerRadius: 26))
                .onTapGesture { focused = true }
                .allowsHitTesting(!model.queueBusy)
                .accessibilityHidden(true)
        }
        .onChange(of: focused) { _, value in if value { editorAccessible = true } }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { Task { await model.composition.flush() } }
        }
        .onDisappear { Task { await model.composition.flush() } }
        .onDrop(of: [UTType.fileURL.identifier, UTType.image.identifier], isTargeted: nil) { providers in
            guard model.canAttach, !model.queueBusy else { return false }
            importProviders(providers)
            return true
        }
        .fileImporter(isPresented: $sheets.files, allowedContentTypes: [.item], allowsMultipleSelection: true) {
            result in
            switch result {
            case .success(let urls): importFiles(urls)
            case .failure(let error): model.composition.problem = error.localizedDescription
            }
        }
        .photosPicker(
            isPresented: $sheets.photos, selection: $photos, maxSelectionCount: ChatDraftLimits.files,
            matching: .images
        )
        .onChange(of: photos) { _, selected in
            guard !selected.isEmpty else { return }
            photos = []
            let jobs = selected.enumerated().compactMap { index, item -> (UUID, PhotosPickerItem, String)? in
                let name = "Photo \(model.attachments.count + index + 1)"
                return model.composition.reserve(name).map { ($0, item, name) }
            }
            Task {
                for (id, item, name) in jobs {
                    do {
                        guard let data = try await item.loadTransferable(type: Data.self) else {
                            throw DraftFailure("Could not read this photo.")
                        }
                        let type = item.supportedContentTypes.first ?? .jpeg
                        await model.composition.finishImport(
                            id, data: data, name: name + "." + (type.preferredFilenameExtension ?? "jpg"),
                            mime: type.preferredMIMEType ?? "image/jpeg")
                    } catch { model.composition.failImport(id, error: error) }
                }
            }
        }
        .fullScreenCover(isPresented: $sheets.camera) {
            ChatCameraPicker(capture: importCapture).ignoresSafeArea()
        }
        .quickLookPreview($preview)
        .mobileSheet(isPresented: Binding(get: { sheets.picker != nil }, set: { if !$0 { sheets.picker = nil } })) {
            ChatContextPicker(model: model, kind: sheets.picker ?? "@") { suggestion in
                model.chooseSuggestion(suggestion)
                sheets.picker = nil
                focused = true
            }
        }
        .mobileSheet(isPresented: $sheets.expanded) {
            NavigationStack {
                editor(maximumHeight: 10_000, focus: $expandedFocus)
                    .padding(20).frame(maxHeight: .infinity, alignment: .top)
                    .navigationTitle("Message")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") {
                                sheets.expanded = false
                                focused = true
                            }
                        }
                    }
                    .onAppear { expandedFocus = true }
            }
        }
        .confirmationDialog(
            "Paste this long text",
            isPresented: Binding(get: { pastedText != nil }, set: { if !$0 { pastedText = nil } })
        ) {
            if let text = pastedText {
                Button("Attach as a text file") {
                    Task {
                        await model.addAttachment(data: Data(text.utf8), name: "Pasted text.txt", mime: "text/plain")
                    }
                    pastedText = nil
                }
                Button("Paste into message") {
                    insertText(text)
                    pastedText = nil
                }
                Button("Cancel", role: .cancel) { pastedText = nil }
            }
        }
    }

    private func editor(maximumHeight: CGFloat, focus: Binding<Bool>) -> some View {
        let selection = Binding<NSRange>(
            get: { model.composition.selection }, set: { model.composition.selection = $0 })
        let importAction: (([NSItemProvider]) -> Void)? = model.canAttach ? { importProviders($0) } : nil
        let pasteAction: ((String) -> Void)? = model.canAttach ? { pastedText = $0 } : nil
        return RichChatComposer(
            text: $model.draft, selection: selection,
            mentions: model.mentions, skills: model.skills, focused: focus,
            placeholder: model.working ? "Add to queue…" : "Message the agent…",
            maximumHeight: maximumHeight,
            importItems: importAction, pasteLongText: pasteAction
        )
        .disabled(model.queueBusy)
    }

    private var sendButton: some View {
        Button(action: send) {
            Image(lucide: model.working ? "list-plus" : "arrow-up", size: 19)
                .frame(width: 40, height: 40)
                .modifier(
                    ChatComposerAction(
                        prompt: false, icon: model.working ? "list-plus" : "arrow-up",
                        loading: model.sending, enabled: model.canSend, emphasized: model.composition.hasContent)
                )
                .contentShape(Circle())
        }
        .buttonStyle(ChatComposerButtonStyle())
        .disabled(!model.canSend)
        .accessibilityLabel(model.working ? "Add message to queue" : "Send message")
        .accessibilityHint(model.composition.importing ? "Wait for attachments to finish importing." : "")
        .keyboardShortcut(.return, modifiers: .command)
    }

    private var contextStrip: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(model.composition.chats) { chat in
                    HStack(spacing: 4) {
                        Label(chat.title, lucideIcon: "messages-square", iconSize: 16).lineLimit(1)
                        Button {
                            model.composition.chats.removeAll { $0.id == chat.id }
                        } label: {
                            Image(lucide: "x", size: 14).frame(width: 44, height: 44)
                        }.accessibilityLabel("Remove conversation \(chat.title)")
                    }.font(.caption).padding(.leading, 12).background(
                        MobileStyle.inset, in: RoundedRectangle(cornerRadius: 12))
                }
                ForEach(model.attachments) { upload in
                    ChatDraftAttachment(upload: upload, preview: { preview = upload.url }) {
                        model.attachments.removeAll { $0.id == upload.id }
                    }
                }
                ForEach(model.composition.imports) { item in
                    HStack(spacing: 8) {
                        if item.error == nil {
                            ProgressView()
                        } else {
                            Image(lucide: "circle-alert", size: 18).foregroundStyle(MobileStyle.statusError)
                        }
                        VStack(alignment: .leading) {
                            Text(item.name).lineLimit(1)
                            Text(item.error ?? "Importing…").font(.caption).foregroundStyle(MobileStyle.muted)
                                .lineLimit(2)
                        }.frame(maxWidth: 170)
                        Button {
                            model.composition.imports.removeAll { $0.id == item.id }
                        } label: {
                            Image(lucide: "x", size: 14).frame(width: 44, height: 44)
                        }.accessibilityLabel("Remove \(item.name)")
                    }.font(.footnote).padding(.leading, 12).background(
                        MobileStyle.inset, in: RoundedRectangle(cornerRadius: 12))
                }
            }.padding(.horizontal, 12)
        }.scrollIndicators(.hidden).disabled(model.queueBusy)
    }

    private func insertText(_ text: String) {
        let source = model.draft as NSString
        let location = min(model.composition.selection.location, source.length)
        let range = NSRange(
            location: location, length: min(model.composition.selection.length, source.length - location))
        model.draft = source.replacingCharacters(in: range, with: text)
        model.composition.selection = NSRange(location: location + (text as NSString).length, length: 0)
    }

    private func importCapture(_ image: UIImage) {
        let name = "Photo \(model.attachments.count + model.composition.imports.count + 1).jpg"
        guard let id = model.composition.reserve(name) else { return }
        Task {
            guard let data = await Task.detached(operation: { image.jpegData(compressionQuality: 0.85) }).value else {
                model.composition.failImport(id, error: DraftFailure("Could not read this photo."))
                return
            }
            await model.composition.finishImport(id, data: data, name: name, mime: "image/jpeg")
        }
    }

    private func importFiles(_ urls: [URL]) {
        let jobs = urls.compactMap { url in model.composition.reserve(url.lastPathComponent).map { ($0, url) } }
        Task {
            for (id, url) in jobs {
                do {
                    let data = try await Task.detached {
                        let access = url.startAccessingSecurityScopedResource()
                        defer { if access { url.stopAccessingSecurityScopedResource() } }
                        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                        guard size <= ChatDraftLimits.bytes else { throw DraftFailure("Files must be at most 10 MiB.") }
                        return try Data(contentsOf: url, options: .mappedIfSafe)
                    }.value
                    let type = UTType(filenameExtension: url.pathExtension)
                    await model.composition.finishImport(
                        id, data: data, name: url.lastPathComponent,
                        mime: type?.preferredMIMEType ?? "application/octet-stream")
                } catch { model.composition.failImport(id, error: error) }
            }
        }
    }

    private func importProviders(_ providers: [NSItemProvider]) {
        for provider in providers {
            let name = provider.suggestedName ?? "Pasted image"
            guard let id = model.composition.reserve(name) else { continue }
            Task {
                do {
                    let typeID =
                        provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
                        ? UTType.fileURL.identifier
                        : provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .image) == true }
                    guard let typeID else { throw DraftFailure("This item cannot be attached.") }
                    let data: Data = try await withCheckedThrowingContinuation { continuation in
                        provider.loadDataRepresentation(forTypeIdentifier: typeID) { data, error in
                            if let data {
                                continuation.resume(returning: data)
                            } else {
                                continuation.resume(throwing: error ?? DraftFailure("Could not read this item."))
                            }
                        }
                    }
                    guard model.composition.imports.contains(where: { $0.id == id }) else { return }
                    if typeID == UTType.fileURL.identifier, let url = URL(dataRepresentation: data, relativeTo: nil) {
                        model.composition.imports.removeAll { $0.id == id }
                        importFiles([url])
                    } else {
                        let type = UTType(typeID)
                        let filename =
                            (name as NSString).pathExtension.isEmpty
                            ? name + "." + (type?.preferredFilenameExtension ?? "png") : name
                        await model.composition.finishImport(
                            id, data: data, name: filename, mime: type?.preferredMIMEType ?? "image/png")
                    }
                } catch { model.composition.failImport(id, error: error) }
            }
        }
    }
}

/// The camera through UIKit, since SwiftUI has no picker of its own for it.
private struct ChatCameraPicker: UIViewControllerRepresentable {
    let capture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: ChatCameraPicker

        init(_ parent: ChatCameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage { parent.capture(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

private struct ChatDraftAttachment: View {
    let upload: ChatUpload
    let preview: () -> Void
    let remove: () -> Void
    @State private var image: UIImage?

    var body: some View {
        HStack(spacing: 0) {
            Button(action: preview) {
                HStack(spacing: 10) {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFill().frame(width: 44, height: 44).clipShape(
                            RoundedRectangle(cornerRadius: 8))
                    } else {
                        Image(lucide: "file-text", size: 22).frame(width: 36, height: 44).foregroundStyle(
                            MobileStyle.muted)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(upload.name).font(.footnote.weight(.medium)).lineLimit(1).truncationMode(.middle)
                        Text(mobileAttachmentSize(Double(upload.size))).font(.caption).foregroundStyle(
                            MobileStyle.muted)
                    }.frame(maxWidth: 150, alignment: .leading)
                }.padding(.leading, 8).padding(.vertical, 8)
            }.accessibilityLabel("Preview \(upload.name)")
            Button(action: remove) { Image(lucide: "x", size: 14).frame(width: 44, height: 44) }
                .accessibilityLabel("Remove \(upload.name)")
        }
        .buttonStyle(ChatComposerButtonStyle())
        .background(MobileStyle.inset.opacity(0.65), in: RoundedRectangle(cornerRadius: 16))
        .task(id: upload.id) {
            guard upload.mime.hasPrefix("image/") else { return }
            let url = upload.url
            let thumbnail = await Task.detached {
                guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil as Data? }
                let options: [CFString: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 132, kCGImageSourceCreateThumbnailWithTransform: true,
                ]
                guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                    return nil as Data?
                }
                let data = NSMutableData()
                guard
                    let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil)
                else { return nil }
                CGImageDestinationAddImage(destination, image, nil)
                guard CGImageDestinationFinalize(destination) else { return nil }
                return data as Data
            }.value
            if let thumbnail { image = UIImage(data: thumbnail) }
        }
    }
}

struct ChatContextPicker: View {
    @Bindable var model: ChatModel
    let kind: String
    let choose: (ChatSuggestion) -> Void
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ChatSuggestionRows(model: model, limit: 30, choose: choose)
            }
            .searchable(text: $query)
            .task(id: query) { await model.search(kind, query: query) }
            .navigationTitle(kind == "@" ? "Files and conversations" : kind == "$" ? "Skills" : "Commands")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct ChatSuggestionRows: View {
    @Bindable var model: ChatModel
    var limit = 5
    let choose: (ChatSuggestion) -> Void

    var body: some View {
        if model.searching {
            HStack(spacing: 10) {
                ProgressView()
                Text("Searching…")
            }.font(.subheadline).padding(12)
        } else if let error = model.searchProblem {
            Text(error).font(.subheadline).foregroundStyle(MobileStyle.statusError).padding(12)
        } else if model.suggestions.isEmpty {
            Text("No matches").font(.subheadline).foregroundStyle(MobileStyle.muted).padding(12)
        } else {
            ForEach(Array(model.suggestions.prefix(limit))) { suggestion in
                Button {
                    choose(suggestion)
                } label: {
                    HStack(spacing: 10) {
                        Image(lucide: suggestion.icon, size: 18).foregroundStyle(MobileStyle.muted)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(suggestion.title).font(.subheadline).lineLimit(1).truncationMode(.middle)
                            if !suggestion.detail.isEmpty {
                                Text(suggestion.detail).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        }
                        Spacer(minLength: 0)
                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }.buttonStyle(ChatComposerButtonStyle())
            }
        }
    }
}
