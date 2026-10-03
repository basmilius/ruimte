import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One launch in the editor, saved with the rest of the list against the rev it was read at. A save by a person
/// approves on this machine what it adds or changes, which the sheet says.
@MainActor @Observable final class LaunchEditorModel {
    let store: ProjectLaunches
    let draftID: String
    private(set) var drafts: [LaunchDraft]
    private(set) var baseRev: Int
    var root: String
    var sub: String
    private(set) var tried = false
    private(set) var busy = false
    private(set) var failure: String?
    private(set) var conflict = false

    init(store: ProjectLaunches, launchID: String?) {
        self.store = store
        let document = store.document ?? LaunchesDocument()
        var drafts = document.launches.map(LaunchEditing.draft(of:))
        let editing: String
        if let launchID, drafts.contains(where: { $0.id == launchID }) {
            editing = launchID
        } else {
            let fresh = LaunchEditing.newDraft(id: "new:\(UUID().uuidString)")
            drafts.append(fresh)
            editing = fresh.id
        }
        draftID = editing
        self.drafts = drafts
        baseRev = document.rev
        let cwd = drafts.first { $0.id == editing }?.cwd ?? ""
        let place = LaunchEditing.splitFolder(cwd, roots: LaunchEditing.folderRoots(store.repos))
        root = place.root
        sub = place.sub
    }

    var draft: LaunchDraft {
        get { drafts.first { $0.id == draftID } ?? LaunchEditing.newDraft(id: draftID) }
        set {
            guard let index = drafts.firstIndex(where: { $0.id == draftID }) else { return }
            drafts[index] = newValue
        }
    }

    var isNew: Bool { draft.fresh }

    /// A root the checkouts no longer list still reads as itself until the person picks another.
    var roots: [String] {
        let known = LaunchEditing.folderRoots(store.repos)
        return known.contains(root) ? known : known + [root]
    }

    /// The other services and tasks a group can start.
    var candidates: [LaunchDraft] { drafts.filter { $0.kind != "group" && $0.id != draftID } }

    /// What keeps the save from going out, shown once a save was tried.
    var problem: (id: String, problem: LaunchDraftProblem)? { LaunchEditing.problem(drafts) }

    func moveFolder() {
        draft.cwd = LaunchEditing.joinFolder(root: root, sub: sub)
    }

    func toggle(member: String, on: Bool) {
        draft.members = on ? draft.members + [member] : draft.members.filter { $0 != member }
    }

    func addVariable() { draft.env.append(LaunchEditing.emptyRow(after: draft.env)) }

    func removeVariable(_ id: Int) { draft.env.removeAll { $0.id == id } }

    /// Whether the save landed, so the sheet can close.
    func save() async -> Bool {
        tried = true
        guard problem == nil, !busy else { return false }
        busy = true
        defer { busy = false }
        failure = nil
        conflict = false
        do {
            try await store.save(LaunchEditing.saved(drafts), baseRev: baseRev)
            return true
        } catch LaunchSaveFailure.conflict {
            conflict = true
            failure = LaunchesText.reason(LaunchSaveFailure.conflict)
        } catch {
            failure = LaunchesText.reason(error)
        }
        return false
    }

    /// The latest the machine sent, with what this sheet edits laid over it again: a new launch stays new, and an
    /// existing one is read again as it stands now.
    func startOver() {
        let document = store.document ?? LaunchesDocument()
        var fresh = document.launches.map(LaunchEditing.draft(of:))
        if isNew { fresh.append(draft) }
        drafts = fresh
        baseRev = document.rev
        let place = LaunchEditing.splitFolder(draft.cwd, roots: LaunchEditing.folderRoots(store.repos))
        root = place.root
        sub = place.sub
        failure = nil
        conflict = false
        tried = false
    }
}

struct LaunchEditorSheet: View {
    @State private var model: LaunchEditorModel
    @Environment(\.dismiss) private var dismiss

    init(store: ProjectLaunches, launchID: String?) {
        _model = State(initialValue: LaunchEditorModel(store: store, launchID: launchID))
    }

    var body: some View {
        NavigationStack {
            MobileForm {
                form
            }
            .navigationTitle(model.isNew ? "New launch" : "Edit launch")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { if await model.save() { dismiss() } } }.disabled(model.busy)
                }
            }
        }
    }

    @ViewBuilder private var form: some View {
        let shown = model.tried ? model.problem : nil
        if let failure = model.failure {
            Section {
                Label(failure, lucideIcon: "triangle-alert").foregroundStyle(.red)
                if model.conflict {
                    Button("Start over from the latest") { model.startOver() }
                }
            }
        }
        if let shown, shown.id != model.draftID {
            Section {
                Text("\(model.drafts.first { $0.id == shown.id }?.name ?? String(localized: "Another launch")): \(shown.problem.message)")
                    .foregroundStyle(.red)
            }
        }
        Section {
            TextField("Name", text: $model.draft.name)
            Picker("Kind", selection: $model.draft.kind) {
                Text("Service").tag("service")
                Text("Task").tag("task")
                Text("Group").tag("group")
            }
            .pickerStyle(.segmented)
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                if let shown, shown.id == model.draftID, shown.problem == .name {
                    Text(shown.problem.message).foregroundStyle(.red)
                }
                Text(Self.kindHint(model.draft.kind))
            }
        }
        if model.draft.kind == "group" {
            members(shown)
        } else {
            run(shown)
        }
        Section {
            Toggle(isOn: $model.draft.autostart) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Launch when the project opens")
                    Text("Only once it is approved on this machine.").font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
            Toggle(isOn: $model.draft.shared) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Share with the team")
                    Text(
                        "Shared launches go in .ruimte/launches.json and into git. Keep secrets out of the environment above."
                    )
                    .font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                if model.draft.shared && model.draft.hasOverlay {
                    Text("This machine lays its own folder or variables over this launch; they stay as they are.")
                }
                Text("Saving a launch approves its command on this machine.")
            }
        }
    }

    @ViewBuilder private func members(_ shown: (id: String, problem: LaunchDraftProblem)?) -> some View {
        Section {
            if model.candidates.isEmpty {
                Text("Add a service or a task first.").foregroundStyle(MobileStyle.muted)
            }
            ForEach(model.candidates) { candidate in
                Toggle(
                    candidate.name.isEmpty ? String(localized: "Untitled") : candidate.name,
                    isOn: Binding(
                        get: { model.draft.members.contains(candidate.id) },
                        set: { model.toggle(member: candidate.id, on: $0) }))
            }
        } header: {
            Text("Launches")
        } footer: {
            if let shown, shown.id == model.draftID, shown.problem == .members {
                Text(shown.problem.message).foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder private func run(_ shown: (id: String, problem: LaunchDraftProblem)?) -> some View {
        Section("Directory") {
            Picker("Checkout", selection: $model.root) {
                ForEach(model.roots, id: \.self) { root in
                    Text(root.isEmpty ? String(localized: "Project folder") : root).tag(root)
                }
            }
            .onChange(of: model.root) { model.moveFolder() }
            TextField("Subfolder", text: $model.sub)
                .font(.callout.monospaced()).textInputAutocapitalization(.never).autocorrectionDisabled()
                .onChange(of: model.sub) { model.moveFolder() }
        }
        Section {
            TextField("Command", text: $model.draft.command, axis: .vertical)
                .font(.callout.monospaced()).textInputAutocapitalization(.never).autocorrectionDisabled()
                .lineLimit(1...6)
            if model.draft.kind == "service" {
                TextField("Address, such as http://localhost:8000", text: $model.draft.url)
                    .font(.callout.monospaced()).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.URL)
            }
        } header: {
            Text("Command")
        } footer: {
            if let shown, shown.id == model.draftID, shown.problem == .command {
                Text(shown.problem.message).foregroundStyle(.red)
            }
        }
        Section("Environment") {
            ForEach($model.draft.env) { $row in
                HStack {
                    TextField("Name", text: $row.key).frame(maxWidth: 140)
                    TextField("Value", text: $row.value)
                    Button(String(localized: "Remove \(row.key)"), lucideIcon: "x") { model.removeVariable(row.id) }
                        .labelStyle(.iconOnly).buttonStyle(.borderless)
                }
                .font(.callout.monospaced()).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            Button(String(localized: "Add variable"), lucideIcon: "plus") { model.addVariable() }
        }
    }

    private static func kindHint(_ kind: String) -> String {
        switch kind {
        case "task": String(localized: "Runs until it is done, such as the tests or a build.")
        case "group": String(localized: "Starts the launches checked below together.")
        default:
            String(localized: "Keeps running, such as a web server. With an address it is running once the port answers.")
        }
    }
}

/// What the machine found in the project, each with the command it becomes; nothing is saved until the import, which
/// counts as the person's approval on this machine.
struct LaunchImportSheet: View {
    let store: ProjectLaunches
    @State private var offered: [LaunchSuggestion]?
    @State private var failed = false
    @State private var skipped: Set<String> = []
    @State private var share = false
    @State private var busy = false
    @State private var failure: String?
    @Environment(\.dismiss) private var dismiss

    private var picked: [LaunchSuggestion] {
        (offered ?? []).filter { $0.unsupported == nil && !skipped.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    Text("Nothing is saved until you import. What you import counts as your approval on this machine.")
                        .font(.caption).foregroundStyle(MobileStyle.muted)
                    if let failure { Label(failure, lucideIcon: "triangle-alert").foregroundStyle(.red) }
                }
                if let offered {
                    if failed {
                        Text("Could not look through the project.").foregroundStyle(MobileStyle.muted)
                    } else if offered.isEmpty {
                        Text("Found nothing to import in this project.").foregroundStyle(MobileStyle.muted)
                    } else {
                        Section {
                            ForEach(offered) { suggestion in suggestionRow(suggestion) }
                        }
                        Section {
                            Toggle("Share with the team in .ruimte/launches.json", isOn: $share)
                        }
                    }
                } else {
                    MobileLoadingRow(String(localized: "Looking for run configurations and scripts"))
                }
            }
            .navigationTitle("Import launches")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Import \(picked.count)") { Task { await importPicked() } }
                        .disabled(busy || picked.isEmpty)
                }
            }
            .task {
                let found = await store.detect()
                failed = found == nil
                offered = LaunchEditing.newSuggestions(found ?? [], existing: store.document?.launches ?? [])
            }
        }
    }

    private func suggestionRow(_ suggestion: LaunchSuggestion) -> some View {
        let launch = LaunchEntry(raw: suggestion.launch)
        return Toggle(
            isOn: Binding(
                get: { suggestion.unsupported == nil && !skipped.contains(suggestion.id) },
                set: { on in
                    if on { skipped.remove(suggestion.id) } else { skipped.insert(suggestion.id) }
                })
        ) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(launch.name)
                    Text(LaunchEditing.source(suggestion)).font(.caption).foregroundStyle(MobileStyle.faint).lineLimit(1)
                }
                if let command = launch.command {
                    Text((launch.cwd.map { "\($0) $ " } ?? "") + command).font(.caption.monospaced())
                        .foregroundStyle(MobileStyle.muted).lineLimit(2)
                }
                if let reason = suggestion.unsupported {
                    Text("Not supported: \(reason)").font(.caption).foregroundStyle(MobileStyle.faint)
                } else if suggestion.isPrivate {
                    Text("Stays on this machine: it names a path outside the project.").font(.caption)
                        .foregroundStyle(MobileStyle.faint)
                }
            }
        }
        .disabled(suggestion.unsupported != nil)
    }

    private func importPicked() async {
        guard let document = store.document else { return }
        busy = true
        defer { busy = false }
        failure = nil
        let launches =
            document.launches.map(\.raw) + LaunchEditing.imported(picked, share: share, existing: document.launches)
        do {
            try await store.save(launches, baseRev: document.rev)
            dismiss()
        } catch {
            failure = LaunchesText.reason(error)
        }
    }
}
