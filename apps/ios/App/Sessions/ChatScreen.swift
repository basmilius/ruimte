import PhotosUI
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers

struct ChatScreen: View {
    @State private var model: ChatModel
    @State private var showingFiles = false
    @State private var showingClear = false
    @State private var pickerKind: String?
    @State private var photo: PhotosPickerItem?
    @State private var question: JSONValue?
    let title: String

    init(client: any MachineRequesting, chatID: String, title: String) {
        _model = State(initialValue: ChatModel(client: client, chatID: chatID))
        self.title = title
    }

    var body: some View {
        VStack(spacing: 0) {
            if let error = model.error {
                SessionErrorBanner(message: error) { model.attach() }
            }
            if model.loading { ProgressView("Loading conversation…").padding() }
            ChatTimeline(items: model.items, revision: model.revision, client: model.client, chatID: model.chatID)
                .overlay {
                    if model.items.isEmpty && !model.loading {
                        ContentUnavailableView(
                            "Start a conversation", systemImage: "bubble.left.and.bubble.right",
                            description: Text("Messages and agent work appear here."))
                    }
                }
            if let pending = model.pending.first { pendingDock(pending) }
            composer
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Clear conversation", systemImage: "trash", role: .destructive) { showingClear = true }
                    Button("Reload", systemImage: "arrow.clockwise") { model.attach() }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Conversation actions")
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .confirmationDialog("Clear this conversation?", isPresented: $showingClear, titleVisibility: .visible) {
            Button("Clear conversation", role: .destructive) {
                Task { await model.perform("chat.clear", ["force": .bool(true)]) }
            }
        } message: {
            Text("This removes the conversation history and stops any active turn on every client.")
        }
        .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) {
            result in
            Task {
                do {
                    for url in try result.get() {
                        let accessed = url.startAccessingSecurityScopedResource()
                        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                        guard size <= 25 * 1024 * 1024 else {
                            model.error = "Files must be at most 25 MiB."
                            continue
                        }
                        let data = try Data(contentsOf: url, options: .mappedIfSafe)
                        model.addAttachment(
                            data: data, name: url.lastPathComponent,
                            mime: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                                ?? "application/octet-stream")
                    }
                } catch { model.error = error.localizedDescription }
            }
        }
        .onChange(of: photo) { _, item in
            Task {
                do {
                    if let data = try await item?.loadTransferable(type: Data.self) {
                        let type = item?.supportedContentTypes.first ?? .image
                        model.addAttachment(
                            data: data, name: "Photo.\(type.preferredFilenameExtension ?? "jpg")",
                            mime: type.preferredMIMEType ?? "image/jpeg")
                    }
                } catch { model.error = error.localizedDescription }
                photo = nil
            }
        }
        .sheet(isPresented: Binding(get: { pickerKind != nil }, set: { if !$0 { pickerKind = nil } })) {
            ChatSuggestionPicker(model: model, kind: pickerKind ?? "@") { pickerKind = nil }
        }
        .sheet(isPresented: Binding(get: { question != nil }, set: { if !$0 { question = nil } })) {
            if let question { ChatQuestionSheet(model: model, item: question) }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !model.attachments.isEmpty {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(model.attachments) { upload in
                            Button {
                                model.attachments.removeAll { $0.id == upload.id }
                            } label: {
                                Label(upload.name, systemImage: "xmark.circle.fill").font(.caption).padding(8)
                            }
                            .buttonStyle(.bordered)
                            .accessibilityLabel("Remove \(upload.name)")
                        }
                    }
                }
            }
            if let queue = model.info["queue"]?.arrayValue, !queue.isEmpty {
                Text("\(queue.count) message\(queue.count == 1 ? "" : "s") queued").font(.caption).foregroundStyle(
                    .secondary)
            }
            TextField("Message", text: $model.draft, axis: .vertical)
                .lineLimit(2...8)
                .padding(12)
                .background(.background, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("chat.composer")
            HStack(spacing: 4) {
                Menu {
                    Button("Attach files", systemImage: "doc") { showingFiles = true }
                    Button("Mention a file", systemImage: "at") { pickerKind = "@" }
                    Button("Use a skill", systemImage: "sparkles") { pickerKind = "$" }
                    Button("Command", systemImage: "slash.circle") { pickerKind = "/" }
                } label: {
                    Image(systemName: "plus").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Add context")
                PhotosPicker(selection: $photo, matching: .images) {
                    Image(systemName: "photo").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Attach photo")
                modelMenu
                Spacer(minLength: 0)
                if model.info["activeTurnId"]?.stringValue != nil {
                    Button {
                        Task { await model.perform("chat.cancel") }
                    } label: {
                        Image(systemName: "stop.circle.fill").frame(width: 44, height: 44)
                    }.accessibilityLabel("Stop turn")
                }
                Button {
                    send()
                } label: {
                    if model.sending {
                        ProgressView().frame(width: 44, height: 44)
                    } else {
                        Image(systemName: "arrow.up.circle.fill").font(.title).frame(width: 44, height: 44)
                    }
                }
                .disabled(
                    !model.connected || model.loading || model.sending
                        || (model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            && model.attachments.isEmpty)
                )
                .accessibilityLabel("Send message")
                .keyboardShortcut(.return, modifiers: .command)
            }
            .disabled(!model.connected || model.loading)
        }
        .padding(12)
        .background(.bar)
    }

    private var modelMenu: some View {
        Menu {
            Section("Model") {
                ForEach(Array(model.models.enumerated()), id: \.offset) { _, option in
                    Button(option["name"]?.stringValue ?? "Model") {
                        Task {
                            await model.perform(
                                "chat.configure",
                                ["selection": .object(["model": option["slug"] ?? .null, "options": .object([:])])])
                        }
                    }
                }
            }
            if let selected = model.models.first(where: { $0["slug"] == model.info["selection"]?["model"] }) {
                ForEach(Array((selected["options"]?.arrayValue ?? []).enumerated()), id: \.offset) { _, option in
                    Menu(option["label"]?.stringValue ?? "Option") {
                        if option["type"]?.stringValue == "boolean" {
                            Button("On") { configureOption(option, value: .bool(true)) }
                            Button("Off") { configureOption(option, value: .bool(false)) }
                        } else {
                            ForEach(Array((option["choices"]?.arrayValue ?? []).enumerated()), id: \.offset) {
                                _, choice in
                                Button(choice["label"]?.stringValue ?? "Choice") {
                                    configureOption(option, value: choice["id"] ?? .null)
                                }
                            }
                        }
                    }
                }
            }
            Section("Permissions") {
                ForEach(["supervised", "auto-accept-edits", "auto", "full-access"], id: \.self) { mode in
                    Button(mode.replacingOccurrences(of: "-", with: " ").capitalized) {
                        Task { await model.perform("chat.configure", ["runtimeMode": .string(mode)]) }
                    }
                }
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(model.info["selection"]?["model"]?.stringValue ?? "Model").lineLimit(1)
                Text(model.info["runtimeMode"]?.stringValue ?? "Permissions").font(.caption2).foregroundStyle(
                    .secondary)
            }.font(.caption).frame(minHeight: 44)
        }
    }

    private func configureOption(_ option: JSONValue, value: JSONValue) {
        guard let key = option["id"]?.stringValue, var selection = model.info["selection"]?.objectValue else { return }
        var options = selection["options"]?.objectValue ?? [:]
        options[key] = value
        selection["options"] = .object(options)
        Task { await model.perform("chat.configure", ["selection": .object(selection)]) }
    }

    private func send() {
        switch model.draft.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "/clear": showingClear = true
        case "/stop": Task { if await model.perform("chat.cancel") { model.draft = "" } }
        case "/compact": Task { if await model.perform("chat.compact") { model.draft = "" } }
        default: Task { await model.send() }
        }
    }

    private func pendingDock(_ item: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(item["toolName"]?.stringValue ?? "Question", systemImage: "hand.raised").font(.headline)
                Spacer()
                if model.pending.count > 1 { Text("\(model.pending.count - 1) more").font(.caption) }
            }
            if item["kind"]?.stringValue == "approval" {
                Text(item["description"]?.stringValue ?? "The agent needs permission to continue.").font(.subheadline)
                    .lineLimit(5)
                if let input = item["input"], let data = try? input.encoded(),
                    let text = String(data: data, encoding: .utf8)
                {
                    DisclosureGroup("Request details") {
                        CodeMessage(text: text, language: "json").frame(maxHeight: 180)
                    }
                }
                HStack {
                    approvalButton("Deny", decision: "deny", item: item)
                    approvalButton("Allow", decision: "allow", item: item)
                    if item["canAllowAlways"]?.boolValue == true {
                        approvalButton("Always allow", decision: "allow-always", item: item)
                    }
                }.buttonStyle(.bordered)
            } else {
                Button("Answer questions") { question = item }.buttonStyle(.borderedProminent)
            }
        }.padding().background(.regularMaterial).disabled(!model.connected)
    }

    private func approvalButton(_ label: String, decision: String, item: JSONValue) -> some View {
        Button(label) {
            Task {
                await model.perform(
                    "chat.approve", ["requestId": item["requestId"] ?? .null, "decision": .string(decision)])
            }
        }
    }
}

struct SessionErrorBanner: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        HStack(alignment: .top) {
            Image(systemName: "exclamationmark.circle")
            Text(message).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
            Button("Retry", action: retry)
        }.padding().background(.regularMaterial).accessibilityElement(children: .contain)
    }
}

private struct ChatSuggestionPicker: View {
    @Bindable var model: ChatModel
    let kind: String
    let close: () -> Void
    @State private var query = ""
    var body: some View {
        NavigationStack {
            List(model.suggestions, id: \.self) { value in
                Button(kind + value) {
                    model.chooseSuggestion(value)
                    close()
                }
            }
            .overlay { if model.suggestions.isEmpty { ContentUnavailableView.search(text: query) } }
            .searchable(text: $query)
            .task(id: query) { await model.search(kind, query: query) }
            .navigationTitle(kind == "@" ? "Files" : kind == "$" ? "Skills" : "Commands")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done", action: close) } }
        }
    }
}

private struct ChatQuestionSheet: View {
    @Bindable var model: ChatModel
    let item: JSONValue
    @Environment(\.dismiss) private var dismiss
    @State private var answers: [String: String] = [:]
    @State private var selected: [String: Set<String>] = [:]
    @State private var submitting = false
    private var questions: [JSONValue] { item["questions"]?.arrayValue ?? [] }
    var body: some View {
        NavigationStack {
            Form {
                ForEach(Array(questions.enumerated()), id: \.offset) { _, question in
                    let id = question["id"]?.stringValue ?? ""
                    Section(question["header"]?.stringValue ?? "Question") {
                        Text(question["question"]?.stringValue ?? "")
                        ForEach(Array((question["choices"]?.arrayValue ?? []).enumerated()), id: \.offset) {
                            _, choice in
                            let label = choice["label"]?.stringValue ?? ""
                            Button {
                                if question["multiSelect"]?.boolValue == true {
                                    var values = selected[id] ?? []
                                    if values.contains(label) { values.remove(label) } else { values.insert(label) }
                                    selected[id] = values
                                    answers[id] = values.sorted().joined(separator: ", ")
                                } else {
                                    answers[id] = label
                                }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(label)
                                        Text(choice["description"]?.stringValue ?? "").font(.caption).foregroundStyle(
                                            .secondary)
                                    }
                                    Spacer()
                                    if answers[id] == label || selected[id]?.contains(label) == true {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                        TextField(
                            "Your answer",
                            text: Binding(
                                get: { answers[id] ?? "" },
                                set: {
                                    answers[id] = $0
                                    selected[id] = []
                                }), axis: .vertical)
                    }
                }
                if let error = model.error { Text(error).foregroundStyle(.red) }
                if item["async"]?.boolValue == true {
                    Button("Dismiss question") {
                        Task { if await model.perform("chat.dismiss", ["itemId": item["id"] ?? .null]) { dismiss() } }
                    }
                }
            }
            .navigationTitle("Answer questions")
            .onChange(of: model.revision) { _, _ in
                if !model.pending.contains(where: { $0["requestId"] == item["requestId"] }) { dismiss() }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") {
                        submitting = true
                        Task {
                            if await model.perform(
                                "chat.answer",
                                [
                                    "requestId": item["requestId"] ?? .null,
                                    "answers": .object(answers.mapValues(JSONValue.string)),
                                ])
                            {
                                dismiss()
                            }
                            submitting = false
                        }
                    }.disabled(
                        submitting
                            || questions.contains {
                                (answers[$0["id"]?.stringValue ?? ""] ?? "").trimmingCharacters(
                                    in: .whitespacesAndNewlines
                                ).isEmpty
                            })
                }
            }
        }
    }
}
