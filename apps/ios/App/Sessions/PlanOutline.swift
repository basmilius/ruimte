import Foundation
import RuimtePulsar

/// The six states of a step are final on the wire, so a switch over them needs no default.
enum PlanStepState: String, CaseIterable, Sendable {
    case open, active, done, failed, skipped, blocked, warning, info
}

extension PlanStepState {
    /// The states a person picks from; active is the agent's word for where it works.
    static let personStates: [PlanStepState] = [.open, .done, .failed, .skipped, .blocked]
    /// The outcomes the mark of a test step offers.
    static let testOutcomes: [PlanStepState] = [.done, .warning, .info, .failed, .skipped, .blocked]

    /// Outcomes that close a step without a failure, as `isFinishedOutcome` in `@ruimte/plan`.
    var isFinished: Bool { self == .done || self == .skipped || self == .warning || self == .info }

    /// A note says what went wrong or what to read, so these ask for one before the state is sent.
    var asksForNote: Bool { self == .failed || self == .warning || self == .info }
}

/// Which steps the sheet lists; local to this phone, never part of the plan.
enum PlanFilter: String, CaseIterable, Sendable {
    case all, open, failed

    var label: String {
        switch self {
        case .all: "All steps"
        case .open: "Open steps"
        case .failed: "Failed steps"
        }
    }

    func matches(_ leaves: [PlanStep]) -> Bool {
        switch self {
        case .all: true
        case .open: leaves.contains { [.open, .active, .blocked].contains($0.state) }
        case .failed: leaves.contains { $0.state == .failed }
        }
    }
}

enum PlanRow: Identifiable, Equatable, Sendable {
    case section(PlanGroup, collapsed: Bool)
    case text(PlanText)
    case step(PlanStep, depth: Int, collapsed: Bool)

    var id: String {
        switch self {
        case .section(let group, _): group.id
        case .text(let text): text.id
        case .step(let step, _, _): step.id
        }
    }
}

enum PlanChecks: String, Sendable {
    case anyone, agent, person
}

enum PlanKind: String, Sendable {
    case steps, test
}

struct PlanStep: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let description: String?
    let checks: PlanChecks?
    /// Only a leaf stores a state; a parent's follows from its children.
    let storedState: PlanStepState?
    let by: String?
    let at: String?
    let note: String?
    let unlocked: Bool
    let steps: [PlanStep]

    var isParent: Bool { !steps.isEmpty }

    /// The same rules as `deriveState` in `@ruimte/plan`, so the phone and the desktop show one state.
    var state: PlanStepState {
        guard isParent else { return storedState ?? .open }
        let states = steps.map(\.state)
        if states.contains(.failed) { return .failed }
        if states.contains(.blocked) { return .blocked }
        // A warning bubbles up so a parent does not look clean; info is only worth reading on the step itself.
        if states.allSatisfy(\.isFinished) { return states.contains(.warning) ? .warning : .done }
        if states.contains(where: { [.active, .done, .warning, .info].contains($0) }) { return .active }
        return .open
    }

    var leaves: [PlanStep] { isParent ? steps.flatMap(\.leaves) : [self] }

    /// A collapsed parent still shows where the agent works.
    var hasActiveLeaf: Bool { leaves.contains { $0.state == .active } }

    var progress: PlanProgress { PlanProgress(leaves: leaves) }

    /// A tap on the circle of a steps plan: done goes back to open, anything else becomes done.
    var toggled: PlanStepState { state == .done ? .open : .done }

    init?(_ value: JSONValue) {
        guard value.text("type") == "step", let id = value["id"]?.stringValue else { return nil }
        self.id = id
        title = value.text("title")
        description = value["description"]?.stringValue
        checks = value["checks"]?.stringValue.flatMap(PlanChecks.init(rawValue:))
        storedState = value["state"]?.stringValue.flatMap(PlanStepState.init(rawValue:))
        by = value["by"]?.stringValue
        at = value["at"]?.stringValue
        note = value["note"]?.stringValue
        unlocked = value["unlocked"]?.boolValue == true
        steps = value.list("steps").compactMap(PlanStep.init)
    }
}

struct PlanText: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let description: String?
}

enum PlanEntry: Identifiable, Equatable, Sendable {
    case text(PlanText)
    case step(PlanStep)

    var id: String {
        switch self {
        case .text(let text): text.id
        case .step(let step): step.id
        }
    }

    init?(_ value: JSONValue) {
        switch value.text("type") {
        case "text":
            guard let id = value["id"]?.stringValue else { return nil }
            self = .text(PlanText(id: id, title: value.text("title"), description: value["description"]?.stringValue))
        case "step":
            guard let step = PlanStep(value) else { return nil }
            self = .step(step)
        default:
            return nil
        }
    }
}

/// A section of a list: a category of the plan, or a run of items at the top of the plan outside any category,
/// which has no title.
struct PlanGroup: Identifiable, Equatable, Sendable {
    let id: String
    let title: String?
    let description: String?
    let entries: [PlanEntry]

    var steps: [PlanStep] {
        entries.compactMap {
            if case .step(let step) = $0 { return step }
            return nil
        }
    }

    var progress: PlanProgress { PlanProgress(leaves: steps.flatMap(\.leaves)) }
}

/// Counts over leaf steps only, as `planProgress` in `@ruimte/plan` does: a parent is its children.
struct PlanProgress: Equatable, Sendable {
    var total = 0
    var counts: [PlanStepState: Int] = [:]

    init(leaves: [PlanStep]) {
        total = leaves.count
        for leaf in leaves { counts[leaf.state, default: 0] += 1 }
    }

    func count(_ state: PlanStepState) -> Int { counts[state] ?? 0 }

    /// Steps with an outcome.
    var finished: Int { count(.done) + count(.failed) + count(.skipped) + count(.warning) + count(.info) }

    var fraction: Double { total == 0 ? 0 : Double(finished) / Double(total) }

    var label: String { "\(finished)/\(total)" }
}

struct PlanDocument: Identifiable, Equatable, Sendable {
    let id: String
    let rev: Int
    let createdAt: String
    let title: String
    let kind: PlanKind
    let summary: String?
    let status: String?
    let checks: PlanChecks
    let groups: [PlanGroup]

    init?(_ value: JSONValue) {
        guard let id = value["id"]?.stringValue, let meta = value["meta"] else { return nil }
        self.id = id
        rev = Int(value.number("rev"))
        createdAt = value.text("createdAt")
        title = meta.text("title")
        kind = PlanKind(rawValue: meta.text("kind")) ?? .steps
        summary = meta["summary"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        status = meta["status"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        checks = PlanChecks(rawValue: meta.text("checks")) ?? .anyone
        var groups: [PlanGroup] = []
        var loose: [PlanEntry] = []
        let closeLoose = {
            guard let first = loose.first else { return }
            groups.append(PlanGroup(id: "top-\(first.id)", title: nil, description: nil, entries: loose))
            loose = []
        }
        for item in value.list("items") {
            if item.text("type") == "section" {
                closeLoose()
                groups.append(
                    PlanGroup(
                        id: item.text("id"), title: item.text("title"), description: item["description"]?.stringValue,
                        entries: item.list("items").compactMap(PlanEntry.init)))
            } else if let entry = PlanEntry(item) {
                loose.append(entry)
            }
        }
        closeLoose()
        self.groups = groups
    }

    var steps: [PlanStep] { groups.flatMap(\.steps) }

    var progress: PlanProgress { PlanProgress(leaves: steps.flatMap(\.leaves)) }

    var activeSteps: [PlanStep] { steps.flatMap(\.leaves).filter { $0.state == .active } }

    /// Unlocked wins over everything: a person lifted the lock and no one puts it back.
    func effectiveChecks(_ step: PlanStep) -> PlanChecks { step.unlocked ? .anyone : (step.checks ?? checks) }

    /// Whether a person may set the state. The machine decides; this only keeps a locked step from offering taps it
    /// would refuse.
    func personMaySet(_ step: PlanStep) -> Bool { !step.isParent && effectiveChecks(step) != .agent }

    func mayUnlock(_ step: PlanStep) -> Bool { !step.isParent && effectiveChecks(step) == .agent }

    /// "6 of 11 run, 5 passed, 1 failed" for a test plan, "6 of 11 done" for a steps plan.
    var progressSummary: String {
        let progress = progress
        let warnings = progress.count(.warning)
        var parts: [String]
        var extras: [(PlanStepState, String)]
        if kind == .test {
            parts = ["\(progress.finished) of \(progress.total) run", "\(progress.count(.done)) passed"]
            extras = [(.warning, warnings == 1 ? "warning" : "warnings"), (.info, "info")]
        } else {
            // In a steps plan a warning or info is still done; the extras say which of the done steps to read.
            let done = progress.count(.done) + warnings + progress.count(.info)
            parts = ["\(done) of \(progress.total) done"]
            extras = [(.warning, warnings == 1 ? "with a warning" : "with warnings"), (.info, "with info")]
        }
        extras += [(.failed, "failed"), (.skipped, "skipped"), (.blocked, "blocked")]
        for (state, word) in extras where progress.count(state) > 0 {
            parts.append("\(progress.count(state)) \(word)")
        }
        return parts.joined(separator: ", ")
    }

    /// The same words as `stateLabel` in the desktop client: a test is passed, not done.
    func word(for state: PlanStepState) -> String {
        switch state {
        case .open: kind == .test ? "Not run" : "Open"
        case .active: kind == .test ? "Running" : "Active"
        case .done: kind == .test ? "Passed" : "Done"
        case .failed: "Failed"
        case .skipped: "Skipped"
        case .blocked: "Blocked"
        case .warning: "Warning"
        case .info: "Info"
        }
    }

    /// What a long press offers: a test step also takes a warning or info.
    var stateChoices: [PlanStepState] {
        kind == .test ? PlanStepState.personStates + [.warning, .info] : PlanStepState.personStates
    }

    /// Every section and parent step, what Collapse all folds.
    var foldableIDs: Set<String> {
        func parents(_ step: PlanStep) -> [String] { step.isParent ? [step.id] + step.steps.flatMap(parents) : [] }
        return Set(groups.filter { $0.title != nil }.map(\.id) + steps.flatMap(parents))
    }

    /// The plan as the rows the sheet draws, in document order, with folds and the filter applied, as `planRows` in
    /// the desktop client.
    func rows(filter: PlanFilter, collapseDone: Bool, collapsed: Set<String>) -> [PlanRow] {
        var rows: [PlanRow] = []
        func folded(_ id: String, _ leaves: [PlanStep]) -> Bool {
            collapsed.contains(id) || (collapseDone && !leaves.isEmpty && leaves.allSatisfy { $0.state.isFinished })
        }
        func add(_ step: PlanStep, depth: Int) {
            guard filter.matches(step.leaves) else { return }
            let isCollapsed = step.isParent && folded(step.id, step.leaves)
            rows.append(.step(step, depth: depth, collapsed: isCollapsed))
            guard step.isParent && !isCollapsed else { return }
            for child in step.steps { add(child, depth: depth + 1) }
        }
        for group in groups {
            let leaves = group.steps.flatMap(\.leaves)
            if group.title != nil {
                guard filter.matches(leaves) else { continue }
                let isCollapsed = folded(group.id, leaves)
                rows.append(.section(group, collapsed: isCollapsed))
                if isCollapsed { continue }
            }
            for entry in group.entries {
                switch entry {
                case .text(let text): if filter == .all { rows.append(.text(text)) }
                case .step(let step): add(step, depth: 0)
                }
            }
        }
        return rows
    }

    /// One step as a line of Markdown, as Copy in the desktop client writes it.
    func markdown(for step: PlanStep) -> String {
        let state = step.state
        let mark = state == .done ? "[x]" : "[ ]"
        let label = state == .open || state == .done ? "" : " (\(word(for: state).lowercased()))"
        let note = step.note.map { "\n    > " + $0.replacingOccurrences(of: "\n", with: "\n    > ") } ?? ""
        return "- \(mark) \(step.title)\(label)\(note)"
    }

    /// Newest first, which is the plan a chat shows until a person picks another. A later place in the machine's
    /// list breaks a tie in `createdAt`.
    static func newestFirst(_ plans: [PlanDocument]) -> [PlanDocument] {
        plans.enumerated()
            .sorted {
                $0.element.createdAt == $1.element.createdAt
                    ? $0.offset > $1.offset : $0.element.createdAt > $1.element.createdAt
            }
            .map(\.element)
    }
}

/// The operations a person sends in `plan.apply`; the structure of a plan is the agent's.
enum PlanOps {
    static func set(_ ids: [String], _ state: PlanStepState, note: String? = nil) -> JSONValue {
        var op: [String: JSONValue] = [
            "op": .string("set"), "ids": .array(ids.map(JSONValue.string)), "state": .string(state.rawValue),
        ]
        if let note, !note.isEmpty { op["note"] = .string(note) }
        return .object(op)
    }

    /// An empty text clears the note.
    static func note(_ id: String, _ text: String) -> JSONValue {
        .object(["op": .string("note"), "id": .string(id), "text": .string(text)])
    }

    static func unlock(_ ids: [String]) -> JSONValue {
        .object(["op": .string("unlock"), "ids": .array(ids.map(JSONValue.string))])
    }

    static let noteLimit = 500
}
