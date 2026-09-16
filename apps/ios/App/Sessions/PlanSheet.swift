import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

/// The plans of a chat: what its agent wrote down and a person checks off. A person sets states, writes notes and
/// lifts a lock; the structure stays the agent's. Every change goes through `plan.apply`, and the machine decides.
/// Drawn after the desktop plan panel, so a plan reads the same on both.
struct PlanSheet: View {
    let store: PlanStore
    let chatID: String
    let chatTitle: String
    /// The chat's model, read for whether its agent is at work, so an active step does not spin after the turn ended.
    let model: ChatModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("ruimte.plan.filter") private var filter: PlanFilter = .all
    @AppStorage("ruimte.plan.collapseDone") private var collapseDone = false
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

    /// "Plan 2 of 3", counted from the oldest as the desktop picker does; empty for a chat with one plan.
    private var planPosition: String {
        guard plans.count > 1, let plan, let index = plans.firstIndex(where: { $0.id == plan.id }) else { return "" }
        return "Plan \(plans.count - index) of \(plans.count)"
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
            .navigationTitle(chatTitle)
            .navigationSubtitle(planPosition)
            .navigationBarTitleDisplayMode(.inline)
            .modifier(PlanPicker(plans: plans, selection: Binding(get: { plan?.id ?? "" }, set: { selectedID = $0 })))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                if let plan {
                    ToolbarItem(placement: .topBarTrailing) { viewMenu(plan) }
                }
            }
            .alert(
                noteRequest?.state == nil ? "Note" : "What happened?",
                isPresented: Binding(get: { noteRequest != nil }, set: { if !$0 { noteRequest = nil } }),
                presenting: noteRequest
            ) { request in
                TextField("Note", text: $noteText, axis: .vertical)
                Button("Cancel", role: .cancel) { noteRequest = nil }
                Button(request.state.map { "Mark as \(plan?.word(for: $0).lowercased() ?? $0.rawValue)" } ?? "Save") {
                    saveNote(request)
                }
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
        let context = PlanRowContext(
            plan: plan, working: model.info["activeTurnId"]?.stringValue != nil, agentName: agentName, busy: busy,
            toggle: { id in
                if collapsed.contains(id) { collapsed.remove(id) } else { collapsed.insert(id) }
            },
            set: { step, state in
                if state.asksForNote {
                    ask(step, state: state)
                } else {
                    apply(plan, step: step, [PlanOps.set([step.id], state)])
                }
            },
            note: { ask($0, state: nil) },
            unlock: { apply(plan, step: $0, [PlanOps.unlock([$0.id])]) })
        let rows = plan.rows(filter: filter, collapseDone: collapseDone, collapsed: collapsed)
        return List {
            PlanHeader(plan: plan, working: context.working, agentName: agentName).planRowChrome()
            if rows.isEmpty {
                Text(emptyText)
                    .font(.footnote)
                    .foregroundStyle(MobileStyle.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .planRowChrome()
            }
            ForEach(rows) { row in
                switch row {
                case .section(let group, let isCollapsed):
                    PlanSectionRow(group: group, collapsed: isCollapsed) { context.toggle(group.id) }
                        .planRowChrome()
                case .text(let text):
                    PlanTextRow(text: text).planRowChrome()
                case .step(let step, let depth, let isCollapsed):
                    PlanStepRow(step: step, depth: depth, collapsed: isCollapsed, context: context)
                }
            }
            Color.clear.frame(height: 12).planRowChrome()
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 0)
    }

    /// The view choices the desktop keeps in its overflow menu: which steps show and how much is folded.
    private func viewMenu(_ plan: PlanDocument) -> some View {
        Menu {
            Picker("Show", selection: $filter) {
                ForEach(PlanFilter.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.inline)
            Section {
                Toggle("Collapse done", isOn: $collapseDone)
                Button("Expand all", lucideIcon: "chevrons-up-down") {
                    collapsed = []
                    // Collapse done would keep finished groups folded, and all has to mean all.
                    collapseDone = false
                }
                Button("Collapse all", lucideIcon: "chevrons-down-up") { collapsed = plan.foldableIDs }
            }
        } label: {
            Image(lucide: "ellipsis")
        }
        .accessibilityLabel("Plan view options")
    }

    private var emptyText: String {
        switch filter {
        case .failed: "Nothing failed."
        case .open: "Nothing is open."
        case .all: "This plan has no steps yet."
        }
    }

    private func ask(_ step: PlanStep, state: PlanStepState?) {
        noteText = step.note ?? ""
        noteRequest = PlanNoteRequest(step: step, state: state)
    }

    private func saveNote(_ request: PlanNoteRequest) {
        guard let plan else { return }
        let text = String(noteText.trimmingCharacters(in: .whitespacesAndNewlines).prefix(PlanOps.noteLimit))
        noteRequest = nil
        if let state = request.state {
            apply(plan, step: request.step, [PlanOps.set([request.step.id], state, note: text)])
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
    /// A failed, warning or info step asks for its note before the state is sent, so both land in one rev.
    let state: PlanStepState?
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

/// One column per row, a caret for a group and a mark for a step, so a step right under a section lines up with the
/// section's caret and a child's column sits under its parent's title.
private enum PlanTree {
    static let leading: CGFloat = 12
    static let column: CGFloat = 20
    static let gap: CGFloat = 6
    static let indent: CGFloat = column + gap
}

extension View {
    /// Rows draw their own spacing and background, as the desktop panel does, instead of the grouped list look.
    fileprivate func planRowChrome() -> some View {
        listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

@MainActor
private struct PlanRowContext {
    let plan: PlanDocument
    let working: Bool
    let agentName: String
    let busy: Set<String>
    let toggle: (String) -> Void
    let set: (PlanStep, PlanStepState) -> Void
    let note: (PlanStep) -> Void
    let unlock: (PlanStep) -> Void
}

private struct PlanHeader: View {
    let plan: PlanDocument
    let working: Bool
    let agentName: String
    @ScaledMetric(relativeTo: .body) private var titleIcon: CGFloat = 16
    @ScaledMetric(relativeTo: .caption) private var smallIcon: CGFloat = 13

    var body: some View {
        let progress = plan.progress
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 8) {
                    Image(lucide: "list-checks", size: titleIcon)
                        .foregroundStyle(MobileStyle.muted)
                        .padding(.top, 2)
                    Text(plan.title).font(.body.weight(.medium)).foregroundStyle(MobileStyle.text)
                }
                if let summary = plan.summary {
                    Text(PlanMarkdown.inline(summary)).font(.footnote).foregroundStyle(MobileStyle.muted)
                }
                Text(counters)
                    .font(.footnote)
                    .foregroundStyle(MobileStyle.muted)
                    .monospacedDigit()
                if let status = plan.status {
                    Text(status).font(.footnote).foregroundStyle(MobileStyle.text)
                }
                if let active = plan.activeSteps.first {
                    HStack(spacing: 6) {
                        PlanActiveMark(working: working, size: smallIcon)
                        Text(active.title).lineLimit(1)
                    }
                    .font(.footnote)
                    .foregroundStyle(MobileStyle.muted)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(working ? "Now: \(active.title)" : "\(agentName) stopped at \(active.title)")
                }
            }
            .accessibilityElement(children: .combine)
            PlanProgressBar(progress: progress)
                .padding(.top, 4)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(MobileStyle.border).frame(height: 1) }
    }

    /// The kind and the counters on one line, spaced apart like the desktop header rather than joined by words.
    private var counters: String {
        ([plan.kind == .test ? "Test plan" : "Steps"] + plan.progressSummary.components(separatedBy: ", "))
            .joined(separator: "   ")
    }
}

/// Green for done, passed or info, amber for a warning, red for failed and gray for skipped or blocked, over a sunken
/// track.
private struct PlanProgressBar: View {
    let progress: PlanProgress

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                segment(progress.count(.done) + progress.count(.info), MobileStyle.positive, proxy.size.width)
                segment(progress.count(.warning), MobileStyle.statusNeedsYou, proxy.size.width)
                segment(progress.count(.failed), MobileStyle.statusError, proxy.size.width)
                segment(progress.count(.skipped) + progress.count(.blocked), MobileStyle.faint, proxy.size.width)
            }
        }
        .frame(height: 6)
        .background(MobileStyle.inset)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }

    private func segment(_ count: Int, _ color: Color, _ width: CGFloat) -> some View {
        color.frame(width: progress.total == 0 ? 0 : (width * CGFloat(count) / CGFloat(progress.total)).rounded())
    }
}

private struct PlanSectionRow: View {
    let group: PlanGroup
    let collapsed: Bool
    let toggle: () -> Void
    @ScaledMetric(relativeTo: .subheadline) private var caretSize: CGFloat = 14
    @ScaledMetric(relativeTo: .subheadline) private var lineHeight: CGFloat = 20

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .top, spacing: PlanTree.gap) {
                Image(lucide: collapsed ? "chevron-right" : "chevron-down", size: caretSize)
                    .foregroundStyle(MobileStyle.faint)
                    .frame(width: PlanTree.column, height: lineHeight)
                Text(group.title ?? "")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(MobileStyle.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !group.steps.isEmpty {
                    Text(group.progress.label)
                        .font(.caption)
                        .foregroundStyle(MobileStyle.muted)
                        .monospacedDigit()
                        .frame(minHeight: lineHeight)
                        .fixedSize()
                }
            }
            if !collapsed, let description = group.description, !description.isEmpty {
                Text(PlanMarkdown.inline(description))
                    .font(.footnote)
                    .foregroundStyle(MobileStyle.muted)
                    .padding(.leading, PlanTree.indent)
            }
        }
        .padding(.leading, PlanTree.leading)
        .padding(.trailing, 16)
        .padding(.top, 16)
        .padding(.bottom, 6)
        .contentShape(Rectangle())
        .onTapGesture(perform: toggle)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits([.isHeader, .isButton])
        .accessibilityValue(collapsed ? "Collapsed" : "Expanded")
        .accessibilityAction(.default, toggle)
    }
}

private struct PlanTextRow: View {
    let text: PlanText

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(text.title).font(.subheadline.weight(.medium)).foregroundStyle(MobileStyle.text)
            if let description = text.description, !description.isEmpty {
                Text(PlanMarkdown.inline(description)).font(.footnote).foregroundStyle(MobileStyle.muted)
            }
        }
        .padding(.leading, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) { Rectangle().fill(MobileStyle.border).frame(width: 2) }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }
}

private struct PlanStepRow: View {
    let step: PlanStep
    let depth: Int
    let collapsed: Bool
    let context: PlanRowContext
    @ScaledMetric(relativeTo: .subheadline) private var markSize: CGFloat = 18
    @ScaledMetric(relativeTo: .subheadline) private var caretSize: CGFloat = 14
    @ScaledMetric(relativeTo: .subheadline) private var lineHeight: CGFloat = 20
    @ScaledMetric(relativeTo: .caption) private var smallIcon: CGFloat = 13

    private var plan: PlanDocument { context.plan }
    private var locked: Bool { !step.isParent && plan.effectiveChecks(step) == .agent }
    private var maySet: Bool { plan.personMaySet(step) && !context.busy.contains(step.id) }
    private var stopped: Bool { !step.isParent && step.state == .active && !context.working }
    private var working: Bool { !step.isParent && step.state == .active && context.working }

    var body: some View {
        HStack(alignment: .top, spacing: PlanTree.gap) {
            Group {
                if step.isParent {
                    Image(lucide: collapsed ? "chevron-right" : "chevron-down", size: caretSize)
                        .foregroundStyle(MobileStyle.faint)
                } else {
                    mark
                }
            }
            .frame(width: PlanTree.column, height: lineHeight)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.title)
                    .font(.subheadline)
                    .foregroundStyle(step.state.isFinished ? MobileStyle.muted : MobileStyle.text)
                if stopped {
                    Text("\(context.agentName) stopped here").font(.caption).foregroundStyle(MobileStyle.muted)
                }
                if let description = step.description, !description.isEmpty {
                    Text(PlanMarkdown.inline(description)).font(.footnote).foregroundStyle(MobileStyle.muted)
                }
                if let note = step.note, !note.isEmpty {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(step.state == .failed ? MobileStyle.statusError : MobileStyle.muted)
                        .onTapGesture { context.note(step) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            aside.frame(minHeight: lineHeight).fixedSize()
        }
        .padding(.leading, PlanTree.leading + CGFloat(depth) * PlanTree.indent)
        .padding(.trailing, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .onTapGesture {
            if step.isParent { context.toggle(step.id) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(step.title)
        .accessibilityValue(accessibilityValue)
        .modifier(PlanStepAccessibilityActions(step: step, context: context, collapsed: collapsed, maySet: maySet))
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(working ? MobileStyle.accent.opacity(0.1) : Color.clear)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if plan.kind == .test && maySet {
                Button("Passed", lucideIcon: "circle-check") { context.set(step, .done) }.tint(MobileStyle.positive)
                Button("Info", lucideIcon: "info") { context.set(step, .info) }.tint(MobileStyle.muted)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if plan.kind == .test && maySet {
                Button("Failed", lucideIcon: "circle-x") { context.set(step, .failed) }.tint(MobileStyle.statusError)
                Button("Warning", lucideIcon: "triangle-alert") { context.set(step, .warning) }
                    .tint(MobileStyle.statusNeedsYou)
                Button("Skipped", lucideIcon: "circle-minus") { context.set(step, .skipped) }.tint(.gray)
            }
        }
        .contextMenu { menu }
    }

    @ViewBuilder private var mark: some View {
        if maySet && plan.kind == .steps {
            Button {
                context.set(step, step.toggled)
            } label: {
                glyph.contentShape(Rectangle().inset(by: -10))
            }
            .buttonStyle(.borderless)
        } else if maySet {
            Menu {
                Picker("Outcome", selection: stateBinding) {
                    ForEach(PlanStepState.testOutcomes, id: \.self) { state in
                        Label(plan.word(for: state), lucideIcon: PlanMark.icon(state)).tag(state)
                    }
                }
                .pickerStyle(.inline)
            } label: {
                glyph.contentShape(Rectangle().inset(by: -10))
            }
            .buttonStyle(.borderless)
        } else {
            glyph
        }
    }

    private var glyph: some View {
        PlanMark(state: step.state, working: context.working, size: markSize)
    }

    private var stateBinding: Binding<PlanStepState> {
        Binding(get: { step.state }, set: { context.set(step, $0) })
    }

    @ViewBuilder private var aside: some View {
        if step.isParent {
            HStack(spacing: 4) {
                if step.hasActiveLeaf { PlanActiveMark(working: context.working, size: smallIcon) }
                Text(step.progress.label).monospacedDigit()
            }
            .font(.caption)
            .foregroundStyle(MobileStyle.muted)
        } else {
            HStack(spacing: 4) {
                if step.by == "person", step.state != .open {
                    Text(["you", time].compactMap { $0 }.joined(separator: " · "))
                }
                if locked { Image(lucide: "lock", size: smallIcon) }
            }
            .font(.caption)
            .foregroundStyle(MobileStyle.faint)
        }
    }

    @ViewBuilder private var menu: some View {
        if !step.isParent {
            if let info = menuInfo {
                Section(info) { statusPicker }
            } else {
                statusPicker
            }
        }
        Button(step.note == nil ? "Add note" : "Edit note", lucideIcon: "sticky-note") { context.note(step) }
            .disabled(context.busy.contains(step.id))
        if plan.mayUnlock(step) {
            Button("Unlock", lucideIcon: "lock-open") { context.unlock(step) }
        }
        Button("Copy", lucideIcon: "copy") { UIPasteboard.general.string = plan.markdown(for: step) }
    }

    @ViewBuilder private var statusPicker: some View {
        if maySet {
            Picker("Status", selection: stateBinding) {
                ForEach(plan.stateChoices, id: \.self) { state in
                    Label(plan.word(for: state), lucideIcon: PlanMark.icon(state)).tag(state)
                }
            }
            .pickerStyle(.inline)
        }
    }

    /// Who set the step and whether only the agent checks it, which the desktop keeps in the lock's tooltip.
    private var menuInfo: String? {
        var lines: [String] = []
        if locked { lines.append("Only \(context.agentName) checks this step") }
        if let setBy { lines.append(setBy) }
        return lines.isEmpty ? nil : lines.joined(separator: "\n")
    }

    private var setBy: String? {
        guard let by = step.by, step.state != .open else { return nil }
        let who = by == "person" ? "you" : context.agentName
        return "Set by \(who)" + (time.map { " at \($0)" } ?? "")
    }

    private var time: String? {
        guard let at = step.at, let date = PlanMarkdown.date(at) else { return nil }
        return Calendar.current.isDateInToday(date)
            ? date.formatted(date: .omitted, time: .shortened) : date.formatted(date: .abbreviated, time: .shortened)
    }

    private var accessibilityValue: String {
        var parts: [String] = []
        if step.isParent {
            parts.append("\(step.progress.finished) of \(step.progress.total)")
            parts.append(collapsed ? "Collapsed" : "Expanded")
        } else {
            parts.append(stopped ? "\(context.agentName) stopped here" : plan.word(for: step.state))
        }
        if let note = step.note, !note.isEmpty { parts.append("Note: \(note)") }
        if let menuInfo { parts.append(menuInfo.replacingOccurrences(of: "\n", with: ", ")) }
        return parts.joined(separator: ", ")
    }
}

/// With the row read as one element, the mark's tap and the menu's choices come back as named actions.
private struct PlanStepAccessibilityActions: ViewModifier {
    let step: PlanStep
    let context: PlanRowContext
    let collapsed: Bool
    let maySet: Bool

    func body(content: Content) -> some View {
        let plan = context.plan
        content
            .accessibilityActions {
                if step.isParent {
                    Button(collapsed ? "Expand" : "Collapse") { context.toggle(step.id) }
                }
                if maySet {
                    let choices = plan.kind == .steps ? [step.toggled] : plan.stateChoices
                    ForEach(choices.filter { $0 != step.state }, id: \.self) { state in
                        Button("Mark as \(plan.word(for: state).lowercased())") { context.set(step, state) }
                    }
                }
                Button(step.note == nil ? "Add note" : "Edit note") { context.note(step) }
                if plan.mayUnlock(step) {
                    Button("Unlock") { context.unlock(step) }
                }
            }
    }
}

/// The Lucide circles of the desktop panel, in the same tones.
private struct PlanMark: View {
    let state: PlanStepState
    let working: Bool
    let size: CGFloat

    static func icon(_ state: PlanStepState) -> String {
        switch state {
        case .open: "circle"
        case .active: "loader-circle"
        case .done: "circle-check"
        case .failed: "circle-x"
        case .skipped: "circle-minus"
        case .blocked: "circle-alert"
        case .warning: "triangle-alert"
        case .info: "info"
        }
    }

    var body: some View {
        switch state {
        case .active: PlanActiveMark(working: working, size: size)
        case .open, .skipped: Image(lucide: Self.icon(state), size: size).foregroundStyle(MobileStyle.faint)
        case .done: Image(lucide: Self.icon(state), size: size).foregroundStyle(MobileStyle.positive)
        case .failed: Image(lucide: Self.icon(state), size: size).foregroundStyle(MobileStyle.statusError)
        case .blocked, .warning:
            Image(lucide: Self.icon(state), size: size).foregroundStyle(MobileStyle.statusNeedsYou)
        case .info: Image(lucide: Self.icon(state), size: size).foregroundStyle(MobileStyle.accent)
        }
    }
}

/// A turning ring while the chat's agent works and a pause once it stopped: a step stays active after a turn ends,
/// and a ring there would claim work that is not happening.
private struct PlanActiveMark: View {
    let working: Bool
    let size: CGFloat

    var body: some View {
        if working {
            PlanSpinner(size: size).foregroundStyle(MobileStyle.accent)
        } else {
            Image(lucide: "circle-pause", size: size).foregroundStyle(MobileStyle.muted)
        }
    }
}

/// Reduce Motion keeps the ring still.
private struct PlanSpinner: View {
    let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: reduceMotion)) { timeline in
            Image(lucide: "loader-circle", size: size)
                .rotationEffect(
                    .degrees(
                        reduceMotion
                            ? 0
                            : timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1)
                                * 360))
        }
        .frame(width: size, height: size)
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

/// The desktop plan pill: "6/11" with a double check on a raised capsule, counting the newest plan. A red dot marks a
/// failed step and an accent dot a plan no one here has opened, since the phone never opens one on its own. The check
/// becomes a turning ring while the chat's agent works on an active step.
struct PlanButton: View {
    let plan: PlanDocument
    let unseen: Bool
    let working: Bool
    let open: () -> Void
    @ScaledMetric(relativeTo: .footnote) private var iconSize: CGFloat = 13
    @ScaledMetric(relativeTo: .footnote) private var dotSize: CGFloat = 6

    private var failed: Bool { plan.progress.count(.failed) > 0 }
    private var busy: Bool { working && !plan.activeSteps.isEmpty }

    var body: some View {
        Button(action: open) {
            HStack(spacing: 5) {
                if busy {
                    PlanSpinner(size: iconSize).foregroundStyle(MobileStyle.accent)
                } else {
                    Image(lucide: "check-check", size: iconSize)
                }
                Text(plan.progress.label).monospacedDigit()
                if failed || unseen {
                    HStack(spacing: 2) {
                        if failed { Circle().fill(MobileStyle.statusError).frame(width: dotSize, height: dotSize) }
                        if unseen { Circle().fill(MobileStyle.accent).frame(width: dotSize, height: dotSize) }
                    }
                }
            }
            .font(.footnote)
            .foregroundStyle(MobileStyle.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(MobileStyle.active, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Plan, \(plan.progress.finished) of \(plan.progress.total)")
        .accessibilityValue(
            [unseen ? "New plan" : nil, failed ? "A step failed" : nil, busy ? "In progress" : nil]
                .compactMap { $0 }.joined(separator: ", ")
        )
        .accessibilityIdentifier("chat.plan")
    }
}
