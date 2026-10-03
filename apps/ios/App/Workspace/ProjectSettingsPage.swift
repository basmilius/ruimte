import PhotosUI
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

/// What a project wears and how closing it is put, as the desktop's project settings and close dialog put them.
enum ProjectSettingsLogic {
    enum Mark: String, CaseIterable, Identifiable {
        case initial, icon, image
        var id: Self { self }
        var title: String {
            switch self {
            case .initial: String(localized: "Initial", comment: "A project's mark: the first letter of its name")
            case .icon: String(localized: "Icon", comment: "A project's mark: a symbol")
            case .image: String(localized: "Image", comment: "A project's mark: a picture")
            }
        }
    }

    /// The colors a phone offers; a project keeps any other color its file holds until one of these is picked.
    static let palette = ["#c4573a", "#d49a2a", "#4f9d58", "#3a9da8", "#3a7bc4", "#7a5bc4", "#c45b9a", "#6f6f78"]

    /// The daemon refuses a larger image.
    static let imageLimit = 256 * 1024

    static func mark(of summary: JSONValue) -> Mark {
        switch summary["icon"]?.text("kind") {
        case "lucide": .icon
        case "image": .image
        default: .initial
        }
    }

    static func sameColor(_ lhs: String, _ rhs: String) -> Bool { lhs.lowercased() == rhs.lowercased() }

    /// The name to send, or nil when there is nothing to rename: empty, or what it already is.
    static func rename(_ typed: String, current: String) -> String? {
        let name = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty || name == current ? nil : name
    }

    /// What closing does, in the words of the desktop's close dialog, from what `project.closing` counted.
    static func closing(sessions: Int, otherClients: Int) -> String {
        if otherClients > 0 {
            return String(
                localized:
                    "\(otherClients) other clients still have it open, so nothing stops running. It moves to Recently closed on this phone only."
            )
        }
        if sessions == 0 {
            return String(localized: "Nothing in it is running. It moves to Recently closed just as it was left.")
        }
        return String(
            localized:
                "\(sessions) running sessions end: a terminal loses its scrollback and an agent stops. The rest moves to Recently closed."
        )
    }

    /// A picked picture as a PNG the daemon takes, scaled down until it fits under the limit; nil when it cannot be
    /// read or never fits.
    static func iconImage(_ data: Data) -> (mime: String, base64: String)? {
        guard let image = UIImage(data: data) else { return nil }
        for side in [512.0, 256.0, 128.0] {
            let scale = min(1, side / max(image.size.width, image.size.height))
            let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let png = UIGraphicsImageRenderer(size: size, format: format).pngData { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
            if png.count <= imageLimit { return ("image/png", png.base64EncodedString()) }
        }
        return nil
    }
}

/// A project's name, color and mark, its launches and Close project. The worktree a project is bound to and its
/// default agent are not part of 1.0.
struct ProjectSettingsPage: View {
    let workspace: MobileWorkspace
    let showLaunches: () -> Void
    let closed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var summary: JSONValue
    @State private var name: String
    @State private var mark: ProjectSettingsLogic.Mark
    @State private var photo: PhotosPickerItem?
    @State private var launches: Int?
    @State private var busy = false
    @State private var problem: String?
    @State private var closing: String?
    @State private var pickingSymbol = false

    init(workspace: MobileWorkspace, showLaunches: @escaping () -> Void, closed: @escaping () -> Void) {
        self.workspace = workspace
        self.showLaunches = showLaunches
        self.closed = closed
        _summary = State(initialValue: workspace.summary)
        _name = State(initialValue: workspace.title)
        _mark = State(initialValue: ProjectSettingsLogic.mark(of: workspace.summary))
    }

    private var shown: JSONValue {
        summary.setting("name", .string(workspace.title)).setting("color", .string(color))
    }
    private var color: String { workspace.document.text("color", fallback: summary.text("color")) }

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    VStack(spacing: 12) {
                        ProjectBadge(summary: shown, session: workspace.session, size: 60)
                        HStack(spacing: 8) {
                            ForEach(ProjectSettingsLogic.palette, id: \.self) { hex in
                                Button {
                                    setColor(hex)
                                } label: {
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(Color(projectHex: hex) ?? MobileStyle.accent)
                                        .frame(width: 28, height: 28)
                                        .overlay {
                                            if ProjectSettingsLogic.sameColor(hex, color) {
                                                RoundedRectangle(cornerRadius: 10).stroke(MobileStyle.text, lineWidth: 2)
                                                    .padding(-4)
                                            }
                                        }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Color \(hex)")
                                .accessibilityAddTraits(ProjectSettingsLogic.sameColor(hex, color) ? .isSelected : [])
                            }
                        }
                        Picker("Mark", selection: $mark) {
                            ForEach(ProjectSettingsLogic.Mark.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        markControls
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .listRowBackground(Color.clear)
                }
                Section {
                    LabeledContent("Name") {
                        TextField("Name", text: $name).multilineTextAlignment(.trailing).submitLabel(.done)
                            .onSubmit { Task { await rename() } }
                    }
                    LabeledContent("Folder") {
                        Text(summary.text("folder")).font(.footnote.monospaced()).lineLimit(1).truncationMode(.head)
                    }
                    LabeledContent("Machine", value: workspace.session.machine.name)
                }
                Section {
                    Button(action: showLaunches) {
                        LabeledContent {
                            Text(launches.map(String.init) ?? "")
                        } label: {
                            Label(String(localized: "Launches"), lucideIcon: "play")
                        }
                    }
                    .foregroundStyle(MobileStyle.text)
                }
                Section {
                    Button(String(localized: "Close project"), lucideIcon: "x", role: .destructive) {
                        Task { await askClose() }
                    }
                }
                if let problem { Text(problem).foregroundStyle(MobileStyle.statusError) }
            }
            .disabled(busy)
            .navigationTitle("Project settings")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: $pickingSymbol) {
                IconChoiceGrid(
                    selected: summary["icon"]?.text("value"), resetTitle: String(localized: "Use the initial")
                ) { symbol in
                    pickingSymbol = false
                    let icon = symbol.map { JSONValue.object(["kind": .string("lucide"), "value": .string($0)]) }
                    Task { await setIdentity(icon: icon ?? .null) }
                }
                .navigationTitle("Symbol").navigationBarTitleDisplayMode(.inline)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) {
                        Task {
                            if await rename() { dismiss() }
                        }
                    }
                }
            }
            .alert(
                "Close \(workspace.title)?", isPresented: Binding(get: { closing != nil }, set: { if !$0 { closing = nil } }),
                presenting: closing
            ) { _ in
                Button("Close project", role: .destructive) { Task { await close() } }
                Button("Cancel", role: .cancel) {}
            } message: { consequence in
                Text(consequence)
            }
            .onChange(of: mark) { _, picked in
                if picked == .initial && ProjectSettingsLogic.mark(of: summary) != .initial {
                    Task { await setIdentity(icon: .null) }
                }
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task { await upload(item) }
            }
            .task {
                let store = ProjectLaunches(
                    client: workspace.client, projectID: workspace.projectID, folder: workspace.folder)
                await store.load()
                launches = store.document?.launches.count
            }
        }
        .presentationDetents([.large])
    }

    @ViewBuilder private var markControls: some View {
        switch mark {
        case .initial:
            Text("The first letter of the name, on the project's color.")
                .font(.footnote).foregroundStyle(MobileStyle.muted)
        case .icon:
            Button("Choose a symbol…") { pickingSymbol = true }.font(.subheadline)
        case .image:
            HStack(spacing: 16) {
                PhotosPicker("Choose an image…", selection: $photo, matching: .images)
                Button("Use the folder's icon") { Task { await uploadImage(nil) } }
            }
            .font(.subheadline)
        }
    }

    private func setColor(_ hex: String) {
        Task { await workspace.edit { $0.setting("color", .string(hex)) } }
    }

    /// False when the name could not be written, which keeps the sheet up with what was typed.
    @discardableResult private func rename() async -> Bool {
        guard let typed = ProjectSettingsLogic.rename(name, current: workspace.title) else { return true }
        return await setIdentity(name: typed)
    }

    @discardableResult private func setIdentity(name: String? = nil, icon: JSONValue? = nil) async -> Bool {
        var payload: [String: JSONValue] = ["projectId": .string(workspace.projectID)]
        if let name { payload["name"] = .string(name) }
        if let icon { payload["icon"] = icon }
        return await perform("project.setIdentity", payload)
    }

    private func upload(_ item: PhotosPickerItem) async {
        photo = nil
        guard let data = try? await item.loadTransferable(type: Data.self),
            let image = ProjectSettingsLogic.iconImage(data)
        else {
            problem = String(localized: "This image could not be used. Pick a smaller one.")
            return
        }
        await uploadImage(.object(["mime": .string(image.mime), "base64": .string(image.base64)]))
    }

    private func uploadImage(_ image: JSONValue?) async {
        await perform("project.setIcon", ["projectId": .string(workspace.projectID), "image": image ?? .null])
    }

    @discardableResult private func perform(_ request: String, _ payload: [String: JSONValue]) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            let result = try await workspace.client.request(request, payload: .object(payload))
            if let updated = result["summary"] {
                summary = updated
                mark = ProjectSettingsLogic.mark(of: updated)
            }
            problem = nil
            return true
        } catch {
            problem = error.localizedDescription
            return false
        }
    }

    private func askClose() async {
        do {
            let answer = try await workspace.client.request(
                "project.closing", payload: .object(["projectId": .string(workspace.projectID)]))
            closing = ProjectSettingsLogic.closing(
                sessions: Int(answer.number("sessions")), otherClients: Int(answer.number("otherClients")))
        } catch {
            problem = error.localizedDescription
        }
    }

    private func close() async {
        if await perform("project.close", ["projectId": .string(workspace.projectID)]) { closed() }
    }
}
