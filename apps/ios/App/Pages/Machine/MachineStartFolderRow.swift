import SwiftUI

/// Where browsing starts on a machine, for every client of it: the files of the machine and the folder to open. Saved
/// when the field is submitted or loses focus; empty puts it back to the machine's home folder.
struct MachineStartFolderRow: View {
    let endpoint: MachineEndpoint
    let connected: Bool
    @State private var draft = ""
    @State private var saving = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: MobileSpacing.xSmall) {
            MachineSettingLabel(
                title: String(localized: "Start browsing in"),
                detail: String(localized: "Where files and Open folder start on this machine. Empty means its home folder."))
            TextField(MachinePath(platform: endpoint.platform).example, text: $draft)
                .font(.system(.subheadline, design: .monospaced))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($focused)
                .disabled(saving || !connected)
                .onSubmit { Task { await save() } }
            if let problem {
                Text(verbatim: problem).font(.caption).foregroundStyle(MobileStyle.statusError)
            }
        }
        .onAppear { draft = endpoint.startFolder ?? "" }
        .onChange(of: endpoint.startFolder) { _, kept in
            if !focused { draft = kept ?? "" }
        }
        .onChange(of: focused) { _, focused in
            if !focused { Task { await save() } }
        }
    }

    private func save() async {
        let folder = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard folder != (endpoint.startFolder ?? ""), !saving else { return }
        saving = true
        defer { saving = false }
        do {
            try await endpoint.setStartFolder(folder)
            problem = nil
        } catch {
            problem = String(localized: "Could not save the start folder. \(error.localizedDescription)")
        }
    }
}
