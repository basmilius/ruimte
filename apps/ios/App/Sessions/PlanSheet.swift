import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The plans of a chat: what its agent wrote down and a person checks off. A person sets states, writes notes and
/// lifts a lock; the structure stays the agent's. Every change goes through `plan.apply`, and the machine decides.
struct PlanSheet: View {
    let store: PlanStore
    let chatID: String
    /// The chat's model, read for whether its agent is at work, so an active step does not spin after the turn ended.
    let model: ChatModel
    @Environment(\.dismiss) private var dismiss
    @State private var selectedID: String?
    @State private var collapsed: Set<String> = []
    @State private var busy: Set<String> = []
    @State private var noteRequest: PlanNoteRequest?
    @State private var noteText = ""
    @State private var failure: String?

    private var plans: [PlanDocument] { store.plans(for: chatID) }
    private var plan: PlanDocument? { plans.first { $0.id == selectedID } ?? plans.first }
    private var agentName: String {
        model.providers.first { $0["kind"] == model.info["provider"] }?.text("name") ?? "The agent"
    }

    var body: some View {
        NavigationStack {
            Group {
                if let plan {
                    list(plan)
                } else {
                    ContentUnavailableView(
                        "No plan", lucideIcon: "list-checks", description: Text("This chat has no plan anymore."))
                }
            }
            .modifier(MobilePageSurface())
            .navigationTitle(plan?.title ?? "Plan")
            .navigationSubtitle(plan.map { $0.kind == .test ? "Test plan" : "Plan" } ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .modifier(PlanPicker(plans: plans, selection: Binding(get: { plan?.id ?? "" }, set: { selectedID = $0 })))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .alert(
                noteRequest?.failing == true ? "Why did it fail?" : "Note",
                isPresented: Binding(get: { noteRequest != nil }, set: { if !$0 { noteRequest = nil } }),
                presenting: noteRequest
            ) { request in
                TextField("Note", text: $noteText, axis: .vertical)
                Button("Cancel", role: .cancel) { noteRequest = nil }
                Button(request.failing ? "Mark failed" : "Save") { saveNote(request) }
            } message: { request in
                Text(request.title)
            }
            .alert(
                "The plan did not change",
                isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
            ) {
                Button("OK") { failure = nil }
            } message: {
                Text(failure ?? "")
            }
        }
        .onAppear {
            store.markSeen(chatID)
            // Pinned, so a plan the agent makes while the sheet is open does not take its place.
            if selectedID == nil { selectedID = plans.first?.id }
        }
        .onChange(of: store.unseen.contains(chatID)) { _, unseen in
            if unseen { store.markSeen(chatID) }
        }
    }

    private func list(_ plan: PlanDocument) -> some View {
        let actions = PlanRowActions(
            plan: plan, working: model.info["activeTurnId"]?.stringValue != nil, agentName: agentName, busy: busy,
            expanded: { id in
                Binding(
                    get: { !collapsed.contains(id) },
                    set: { open in
                        if open { collapsed.remove(id) } else { collapsed.insert(id) }
                    })
            },
            set: { step, state in
                if state == .failed {
                    ask(step, failing: true)
                } else {
                    apply(plan, step: step, [PlanOps.set([step.id], state)])
                }
            },
            note: { ask($0, failing: false) },
            unlock: { apply(plan, step: $0, [PlanOps.unlock([$0.id])]) })
        return List {
            Section { PlanHeader(plan: plan, working: actions.working, agentName: agentName) }
            ForEach(plan.groups) { group in
                Section {
                    ForEach(group.entries) { entry in
                        switch entry {
                        case .text(let text): PlanTextRow(text: text)
                        case .step(let step): PlanStepRow(step: step, actions: actions)
                        }
                    }
                } header: {
                    if let title = group.title {
                        HStack(alignment: .firstTextBaseline) {
                            Text(title)
                            Spacer()
                            if !group.steps.isEmpty { Text(group.progress.label).monospacedDigit() }
                        }
                    }
                } footer: {
                    if let description = group.description, !description.isEmpty {
                        Text(PlanMarkdown.inline(description))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
    }

    private func ask(_ step: PlanStep, failing: Bool) {
        noteText = step.note ?? ""
        noteRequest = PlanNoteRequest(step: step, failing: failing)
    }

    private func saveNote(_ request: PlanNoteRequest) {
        guard let plan else { return }
        let text = String(noteText.trimmingCharacters(in: .whitespacesAndNewlines).prefix(PlanOps.noteLimit))
        noteRequest = nil
        if request.failing {
            apply(plan, step: request.step, [PlanOps.set([request.step.id], .failed, note: text)])
        } else {
            apply(plan, step: request.step, [PlanOps.note(request.step.id, text)])
        }
    }

    private func apply(_ plan: PlanDocument, step: PlanStep, _ ops: [JSONValue]) {
        busy.insert(step.id)
        Task {
            defer { busy.remove(step.id) }
            do {
                try await store.apply(chatID: chatID, planID: plan.id, ops: ops)
            } catch {
                failure = ChatForking.message(for: error, action: "check off plans")
            }
        }
    }
}

private struct PlanNoteRequest: Identifiable {
    let step: PlanStep
    /// A failed step asks for its note before the state is sent, so both land in one rev.
    let failing: Bool
    var id: String { step.id }
    var title: String { step.title }
}

/// A picker in the title menu, only for a chat with more than one plan.
private struct PlanPicker: ViewModifier {
    let plans: [PlanDocument]
    @Binding var selection: String

    func body(content: Content) -> some View {
        if plans.count > 1 {
            content.toolbarTitleMenu {
                Picker("Plan", selection: $selection) {
                    ForEach(plans) { plan in
                        Text(plan.title).badge(plan.progress.label).tag(plan.id)
                    }
                }
            }
        } else {
            content
        }
    }
}

@MainActor
private struct PlanRowActions {
    let plan: PlanDocument
    let working: Bool
    let agentName: String
    let busy: Set<String>
    let expanded: (String) -> Binding<Bool>
    let set: (PlanStep, PlanStepState) -> Void
    let note: (PlanStep) -> Void
    let unlock: (PlanStep) -> Void
}

private struct PlanHeader: View {
    let plan: PlanDocument
    let working: Bool
    let agentName: String

    var body: some View {
        let progress = plan.progress
        VStack(alignment: .leading, spacing: 8) {
            if let summary = plan.summary {
                Text(PlanMarkdown.inline(summary)).foregroundStyle(MobileStyle.muted)
            }
            if let status = plan.status {
                Text(status).font(.subheadline.weight(.medium))
            }
            if let active = plan.activeSteps.first {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(working ? "Now:" : "\(agentName) stopped at:").foregroundStyle(MobileStyle.muted)
                    Text(active.title).lineLimit(2)
                }
                .font(.subheadline)
            }
            if progress.total > 0 {
                ProgressView(value: progress.fraction).tint(progress.count(.failed) > 0 ? .red : .green)
                Text(plan.progressSummary).font(.footnote).foregroundStyle(MobileStyle.muted).monospacedDigit()
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct PlanTextRow: View {
    let text: PlanText

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(text.title).font(.subheadline.weight(.semibold))
            if let description = text.description, !description.isEmpty {
                Text(PlanMarkdown.inline(description)).font(.subheadline).foregroundStyle(MobileStyle.muted)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

private struct PlanStepRow: View {
    let step: PlanStep
    let actions: PlanRowActions

    var body: some View {
        if step.isParent {
            DisclosureGroup(isExpanded: actions.expanded(step.id)) {
                ForEach(step.steps) { PlanStepRow(step: $0, actions: actions) }
            } label: {
                content.contextMenu { noteButton }
            }
        } else {
            leaf
        }
    }

    private var plan: PlanDocument { actions.plan }
    private var maySet: Bool { plan.personMaySet(step) && !actions.busy.contains(step.id) }

    private var leaf: some View {
        content
            .listRowBackground(step.state == .active ? MobileStyle.hover : nil)
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                if plan.kind == .test && maySet {
                    Button("Passed", lucideIcon: "circle-check") { actions.set(step, .done) }.tint(.green)
                }
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if plan.kind == .test && maySet {
                    Button("Failed", lucideIcon: "circle-x") { actions.set(step, .failed) }.tint(.red)
                    Button("Skipped", lucideIcon: "circle-minus") { actions.set(step, .skipped) }.tint(.gray)
                }
            }
            .contextMenu {
                if maySet {
                    Section {
                        ForEach(stateChoices, id: \.self) { state in
                            Button(plan.word(for: state), lucideIcon: PlanStateIcon.name(state)) {
                                actions.set(step, state)
                            }
                            .disabled(state == step.state)
                        }
                    }
                }
                noteButton
                if plan.mayUnlock(step) {
                    Button("Unlock", lucideIcon: "lock-open") { actions.unlock(step) }
                }
            }
    }

    private var stateChoices: [PlanStepState] {
        plan.kind == .test ? [.done, .failed, .skipped, .blocked, .open] : [.done, .open]
    }

    private var noteButton: some View {
        Button(step.note == nil ? "Add note" : "Edit note", lucideIcon: "sticky-note") { actions.note(step) }
            .disabled(actions.busy.contains(step.id))
    }

    private var content: some View {
        HStack(alignment: .top, spacing: 10) {
            stateControl
            VStack(alignment: .leading, spacing: 3) {
                Text(step.title)
                    .foregroundStyle(
                        step.state == .done || step.state == .skipped ? MobileStyle.muted : MobileStyle.text)
                if let description = step.description, !description.isEmpty {
                    Text(PlanMarkdown.inline(description)).font(.subheadline).foregroundStyle(MobileStyle.muted)
                }
                if let note = step.note, !note.isEmpty {
                    Text(note).font(.subheadline).foregroundStyle(step.state == .failed ? .red : MobileStyle.text)
                }
                if !step.isParent, let byline {
                    Text(byline).font(.caption).foregroundStyle(MobileStyle.faint)
                }
            }
            .padding(.vertical, 10)
            Spacer(minLength: 0)
            if step.isParent {
                HStack(spacing: 6) {
                    if step.hasActiveLeaf { PlanActiveRing(working: actions.working, size: 14) }
                    Text(step.progress.label).font(.subheadline).foregroundStyle(MobileStyle.muted).monospacedDigit()
                }
                .padding(.top, 12)
            } else if plan.effectiveChecks(step) == .agent {
                Image(lucide: "lock", size: 14).foregroundStyle(MobileStyle.faint).padding(.top, 13)
                    .accessibilityLabel("Only \(actions.agentName) checks this step")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(plan.word(for: step.state))
    }

    @ViewBuilder private var stateControl: some View {
        let icon = PlanStateIcon(state: step.state, working: actions.working, agentName: actions.agentName)
        if plan.kind == .steps && maySet {
            Button {
                actions.set(step, step.toggled)
            } label: {
                icon.frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .padding(.vertical, -2)
            .accessibilityLabel(step.state == .done ? "Mark as open" : "Mark as done")
        } else {
            icon.frame(width: 44, height: 40)
        }
    }

    private var byline: String? {
        guard let by = step.by, step.state != .open else { return nil }
        let who = by == "person" ? "You" : actions.agentName
        guard let at = step.at, let date = PlanMarkdown.date(at) else { return who }
        let time =
            Calendar.current.isDateInToday(date)
            ? date.formatted(date: .omitted, time: .shortened) : date.formatted(date: .abbreviated, time: .shortened)
        return "\(who) · \(time)"
    }
}

private struct PlanStateIcon: View {
    let state: PlanStepState
    let working: Bool
    let agentName: String

    static func name(_ state: PlanStepState) -> String {
        switch state {
        case .open: "circle"
        case .active: "loader-circle"
        case .done: "circle-check"
        case .failed: "circle-x"
        case .skipped: "circle-minus"
        case .blocked: "circle-pause"
        }
    }

    var body: some View {
        switch state {
        case .active:
            PlanActiveRing(working: working, size: 20).accessibilityLabel(
                working ? "In progress" : "\(agentName) stopped here")
        case .open: Image(lucide: Self.name(state), size: 20).foregroundStyle(MobileStyle.faint)
        case .done: Image(lucide: Self.name(state), size: 20).foregroundStyle(.green)
        case .failed: Image(lucide: Self.name(state), size: 20).foregroundStyle(.red)
        case .skipped: Image(lucide: Self.name(state), size: 20).foregroundStyle(MobileStyle.faint)
        case .blocked: Image(lucide: Self.name(state), size: 20).foregroundStyle(.orange)
        }
    }
}

/// Turns only while the chat's agent is at work: a step stays active after a turn ends, and a spinning ring there
/// would claim work that is not happening.
private struct PlanActiveRing: View {
    let working: Bool
    let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if working && !reduceMotion {
            ProgressView().controlSize(.small).frame(width: size, height: size)
        } else {
            Image(lucide: "loader-circle", size: size).foregroundStyle(MobileStyle.muted)
        }
    }
}

enum PlanMarkdown {
    /// Descriptions are short Markdown without headings, so inline styling is all they need.
    static func inline(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    static func date(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }
}

/// "Plan 6/11" beside Sub-agents, counting the newest plan. A dot marks a plan the agent made that no one here has
/// opened, since the phone never opens one on its own.
struct PlanButton: View {
    let plan: PlanDocument
    let unseen: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 6) {
                Text("Plan \(plan.progress.label)").monospacedDigit()
                if unseen {
                    Circle().fill(MobileStyle.accent).frame(width: 6, height: 6)
                } else if plan.progress.count(.failed) > 0 {
                    Circle().fill(.red).frame(width: 6, height: 6)
                }
            }
        }
        .accessibilityLabel("Plan, \(plan.progress.finished) of \(plan.progress.total)")
        .accessibilityValue(unseen ? "New" : plan.progress.count(.failed) > 0 ? "Has failed steps" : "")
        .accessibilityIdentifier("chat.plan")
    }
}
