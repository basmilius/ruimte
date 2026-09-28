import QuickLook
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// A file the app has no view of its own for: Quick Look shows what the system can, and Share hands it to another
/// app. Both need the whole file on the phone, so only a file the machine serves and memory can hold gets them.
struct FileFallbackView: View {
    let client: any MachineRequesting
    let path: String
    let mime: String
    let size: Double?
    /// Why the app's own view does not show it.
    let reason: String
    @State private var file: URL?
    @State private var downloadedKey: String?
    @State private var problem: String?
    @State private var preview: URL?

    private var name: String { URL(fileURLWithPath: path).lastPathComponent }
    private var available: Bool { FileKinds.machineServes(mime: mime) && FileKinds.fitsInMemory(size: size) }

    var body: some View {
        ContentUnavailableView {
            Label(name, lucideIcon: FileKinds.icon(name: name, kind: "file"), iconSize: 48)
        } description: {
            Text(verbatim: "\(reason)\n\(mime), \(mobileByteCount(size))")
        } actions: {
            if let file {
                HStack(spacing: 12) {
                    Button("Quick Look", lucideIcon: "eye") { preview = file }
                        .buttonStyle(.borderedProminent)
                    ShareLink(item: file) { Label("Share", lucideIcon: "share") }
                        .buttonStyle(.bordered)
                }
            } else if let problem {
                Label(problem, lucideIcon: "triangle-alert").foregroundStyle(.red)
            } else if available {
                MobileLoadingRow("Loading")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .quickLookPreview($preview)
        .task(id: fileKey) { await download() }
        // A full-screen Quick Look takes the page off screen too, and still reads the file.
        .onDisappear { if preview == nil { removeFile() } }
    }

    private var fileKey: String { "\(path):\(mime):\(size ?? -1)" }

    private func download() async {
        if file != nil, downloadedKey == fileKey { return }
        removeFile()
        problem = nil
        guard available else { return }
        do {
            let resource = try await client.readResource(.object(["kind": .string("file"), "path": .string(path)]))
            try Task.checkCancellation()
            let folder = FileManager.default.temporaryDirectory.appending(
                path: "ruimte-file-\(UUID().uuidString)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appending(path: name.isEmpty ? "File" : name)
            try resource.data.write(to: url, options: [.atomic, .completeFileProtection])
            file = url
            downloadedKey = fileKey
        } catch is CancellationError {} catch {
            problem = error.localizedDescription
        }
    }

    private func removeFile() {
        if let file { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        file = nil
        downloadedKey = nil
    }
}
