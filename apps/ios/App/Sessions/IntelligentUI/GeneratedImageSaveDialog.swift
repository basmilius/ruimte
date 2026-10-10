import RuimteIntelligentUI
import SwiftUI

/// Saves a generated image into its project. Only the model reaches the machine; the sheet picks a folder inside the
/// project root it was opened for and a name, and Replace stays a separate destructive action that Return never fires.
struct GeneratedImageSaveDialog: View {
    let model: ImageSaveModel
    @State private var expanded: Set<String> = [""]

    var body: some View {
        NavigationStack {
            MobileForm {
                Section("Folder") {
                    ForEach(ImageSaveFolderTree.rows(of: model, expanded: expanded)) { row in
                        folderRow(row)
                    }
                }
                .disabled(model.pending)
                Section {
                    TextField("Name", text: Binding(get: { model.name }, set: { model.setName($0) }))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit(save)
                        .disabled(model.pending)
                } header: {
                    Text("Name")
                } footer: {
                    Text(ImageSaveFolderTree.hint(model))
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .accessibilityLabel(model.destinationPath)
                }
                if !ImageSaveModel.validFileName(model.name) {
                    Section {
                        Text("Enter a file name without a slash").foregroundStyle(MobileStyle.muted)
                    }
                } else if model.exists {
                    Section {
                        Label {
                            Text("\(model.name) already exists in this folder")
                        } icon: {
                            Image(lucide: "circle-alert", size: 14)
                        }
                        .foregroundStyle(MobileStyle.statusNeedsYou)
                        Button(role: .destructive) {
                            Task { await model.save(replace: true) }
                        } label: {
                            Text("Replace")
                        }
                        .disabled(!model.canReplace)
                    }
                }
                if let error = model.error {
                    Section { Text(error).foregroundStyle(MobileStyle.statusError) }
                }
            }
            .navigationTitle("Save image to project")
            .navigationSubtitle(model.projectName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.close() }.disabled(model.pending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.pending || model.checking {
                        ProgressView()
                            .accessibilityLabel(
                                model.pending ? String(localized: "Saving") : String(localized: "Checking"))
                    } else {
                        Button("Save", action: save).disabled(!model.canSave)
                    }
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(model.pending)
        .task { await model.loadFolders() }
        .task(id: model.destinationPath) {
            // Typing a name asks the machine once the name rests, not at every keystroke.
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            await model.check()
        }
        // A swipe that dismisses the sheet answers the host the way Cancel does; after a save this does nothing.
        .onDisappear { model.close() }
    }

    @ViewBuilder private func folderRow(_ row: ImageSaveFolderTree.Row) -> some View {
        switch row.kind {
        case .folder(let directory, let name, let expandable):
            let selected = model.directory == directory
            HStack(spacing: 4) {
                Button {
                    toggle(directory)
                } label: {
                    Image(lucide: expanded.contains(directory) ? "chevron-down" : "chevron-right", size: 14)
                        .foregroundStyle(MobileStyle.faint)
                        .frame(width: 32, height: 44)
                }
                .buttonStyle(.plain)
                .opacity(expandable ? 1 : 0)
                .disabled(!expandable)
                .accessibilityLabel(
                    expanded.contains(directory)
                        ? String(localized: "Collapse \(name)") : String(localized: "Expand \(name)")
                )
                .accessibilityHidden(!expandable)
                Button {
                    model.selectDirectory(directory)
                } label: {
                    HStack(spacing: 8) {
                        Image(lucide: "folder", size: 16)
                            .foregroundStyle(selected ? MobileStyle.accent : MobileStyle.faint)
                        Text(name).lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 8)
                        if selected {
                            Image(lucide: "check", size: 14).foregroundStyle(MobileStyle.accent)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
            .padding(.leading, CGFloat(row.depth) * 20)
        case .loading:
            HStack(spacing: 8) {
                ProgressView()
                Text("Loading").foregroundStyle(MobileStyle.muted)
            }
            .padding(.leading, CGFloat(row.depth) * 20 + 32)
        case .failed(let directory, let message):
            HStack(spacing: 8) {
                Text(message).font(.footnote).foregroundStyle(MobileStyle.statusError).lineLimit(3)
                Spacer(minLength: 8)
                Button("Retry") { Task { await model.loadFolders(directory) } }
            }
            .padding(.leading, CGFloat(row.depth) * 20 + 32)
        case .truncated:
            Text("Not every folder is shown")
                .font(.footnote)
                .foregroundStyle(MobileStyle.muted)
                .padding(.leading, CGFloat(row.depth) * 20 + 32)
        }
    }

    private func toggle(_ directory: String) {
        if expanded.remove(directory) == nil {
            expanded.insert(directory)
            Task { await model.loadFolders(directory) }
        }
    }

    private func save() {
        guard model.canSave else { return }
        Task { await model.save() }
    }
}

/// The folder picker as flat rows, the project root first, so the expanded tree draws in one section and the order is
/// testable without a view.
@MainActor enum ImageSaveFolderTree {
    struct Row: Identifiable, Equatable {
        enum Kind: Equatable {
            /// `expandable` is false once the folder is known to hold no folders.
            case folder(directory: String, name: String, expandable: Bool)
            case loading
            case failed(directory: String, message: String)
            case truncated
        }

        let id: String
        let depth: Int
        let kind: Kind
    }

    static func rows(of model: ImageSaveModel, expanded: Set<String>) -> [Row] {
        var rows: [Row] = []
        func append(directory: String, name: String, depth: Int) {
            let children = model.folders[directory]
            rows.append(
                Row(
                    id: "folder:\(directory)", depth: depth,
                    kind: .folder(directory: directory, name: name, expandable: children?.isEmpty != true)))
            guard expanded.contains(directory) else { return }
            if model.loadingFolders.contains(directory) {
                rows.append(Row(id: "loading:\(directory)", depth: depth + 1, kind: .loading))
            } else if let message = model.folderErrors[directory] {
                rows.append(
                    Row(
                        id: "failed:\(directory)", depth: depth + 1,
                        kind: .failed(directory: directory, message: message)))
            }
            for child in children ?? [] {
                append(directory: child.directory, name: child.name, depth: depth + 1)
            }
            if model.truncatedFolders.contains(directory) {
                rows.append(Row(id: "truncated:\(directory)", depth: depth + 1, kind: .truncated))
            }
        }
        append(directory: "", name: model.projectName, depth: 0)
        return rows
    }

    /// The destination under the project's name, since the absolute path on the machine says little on a phone.
    static func hint(_ model: ImageSaveModel) -> String {
        let path = model.destinationPath
        let root = model.folder.hasSuffix("/") ? model.folder : model.folder + "/"
        return path.hasPrefix(root) ? "\(model.projectName)/\(path.dropFirst(root.count))" : path
    }
}
