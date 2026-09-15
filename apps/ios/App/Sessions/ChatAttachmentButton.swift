import QuickLook
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers

struct ChatAttachmentButton: View {
    let client: any MachineRequesting
    let chatID: String
    let attachment: JSONValue
    @State private var preview: URL?
    @State private var downloaded: URL?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                Task { await load() }
            } label: {
                HStack {
                    if loading { ProgressView() } else { Image(systemName: "paperclip") }
                    Text(attachment["name"]?.stringValue ?? "Attachment")
                    if let size = attachment["size"]?.numberValue {
                        Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)).foregroundStyle(
                            .secondary)
                    }
                }.font(.caption).frame(minHeight: 44)
            }.disabled(loading)
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
        .quickLookPreview($preview)
        .onDisappear {
            if let downloaded { try? FileManager.default.removeItem(at: downloaded.deletingLastPathComponent()) }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let resource = try await client.readResource(
                .object([
                    "kind": .string("attachment"), "chatId": .string(chatID), "attachmentId": attachment["id"] ?? .null,
                ]))
            try Task.checkCancellation()
            let folder = FileManager.default.temporaryDirectory.appending(
                path: "ruimte-attachment-\(UUID().uuidString)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let rawName = attachment["name"]?.stringValue ?? "Attachment"
            let safeName = URL(fileURLWithPath: rawName).lastPathComponent
            let url = folder.appendingPathComponent(
                safeName.isEmpty || safeName == "." || safeName == ".." ? "Attachment" : safeName)
            try resource.data.write(to: url, options: .atomic)
            downloaded = url
            preview = url
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
