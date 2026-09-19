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
            if attachment.text("mime").hasPrefix("image/") {
                ChatInlineImage(
                    resource: .object([
                        "kind": .string("attachment"), "chatId": .string(chatID),
                        "attachmentId": attachment["id"] ?? .null,
                    ]), name: attachment.text("name"))
            }
            Button {
                Task { await load() }
            } label: {
                HStack(spacing: 10) {
                    if loading {
                        ProgressView()
                    } else {
                        Image(lucide: "file-text", size: 18).foregroundStyle(.tint)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(attachment["name"]?.stringValue ?? "Attachment")
                            .font(.caption.weight(.medium)).lineLimit(1).truncationMode(.middle)
                        if let size = attachment["size"]?.numberValue {
                            Text(mobileAttachmentSize(size))
                                .font(.caption2).foregroundStyle(MobileStyle.muted).monospacedDigit()
                        }
                    }
                    Image(lucide: "circle-arrow-down", size: 14).foregroundStyle(MobileStyle.muted)
                }.padding(.horizontal, 12).frame(minHeight: 48)
                    .background(MobileStyle.surface, in: RoundedRectangle(cornerRadius: 12))
            }.buttonStyle(.plain).disabled(loading)
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
        .quickLookPreview($preview)
        .onDisappear {
            if let downloaded { try? FileManager.default.removeItem(at: downloaded.deletingLastPathComponent()) }
            downloaded = nil
        }
    }

    private func load() async {
        if let downloaded {
            preview = downloaded
            return
        }
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
