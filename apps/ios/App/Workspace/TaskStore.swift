import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// Tracks task updates for projects open on this device and reloads each project on open.
@MainActor @Observable
final class TaskStore {
    private(set) var tasks: [String: AgentTask] = [:]
    @ObservationIgnored private var projects: [String: Int] = [:]
    @ObservationIgnored private var subscriptions: [() -> Void] = []
    @ObservationIgnored private let client: any MachineRequesting

    init(client: any MachineRequesting) { self.client = client }

    func start() {
        guard subscriptions.isEmpty else { return }
        subscriptions = [
            client.subscribe(.taskChanged) { [weak self] payload in
                guard let event = try? payload.decoded(as: TaskChangedEvent.self) else { return }
                self?.put(event.task)
            },
            client.observeConnection { [weak self] connected in
                guard let self, connected else { return }
                for projectID in projects.keys { ask(projectID) }
            },
        ]
    }

    func stop() {
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
        projects.removeAll()
        tasks.removeAll()
    }

    func watch(_ projectID: String) {
        projects[projectID, default: 0] += 1
        if projects[projectID] == 1 && !subscriptions.isEmpty { ask(projectID) }
    }

    func unwatch(_ projectID: String) {
        guard let count = projects[projectID] else { return }
        if count > 1 {
            projects[projectID] = count - 1
        } else {
            projects.removeValue(forKey: projectID)
        }
    }

    /// What one project answered; a task of that project it no longer lists is gone.
    func setProjectTasks(_ projectID: String, _ list: [AgentTask]) {
        var next = tasks.filter { $0.value.projectId != projectID }
        for task in list { next[task.id] = task }
        if next != tasks { tasks = next }
    }

    func put(_ task: AgentTask) {
        guard tasks[task.id] != task else { return }
        tasks[task.id] = task
    }

    func task(_ id: String) -> AgentTask? { tasks[id] }

    /// The newest task a node was opened with, since a node given a task twice shows the one it works on now.
    func childTask(_ childID: String) -> AgentTask? {
        tasks.values.filter { $0.childId == childID }.max { $0.createdAt < $1.createdAt }
    }

    /// The nodes that gave another agent a task that has not settled yet.
    var parentsWithOpenTasks: Set<String> {
        Set(tasks.values.filter { $0.status == .open }.map(\.parentId))
    }

    private func ask(_ projectID: String) {
        Task { [weak self, client] in
            guard
                let result = try? await client.request(.taskList, payload: .object(["projectId": .string(projectID)]))
                    .decoded(as: TaskListResult.self)
            else { return }
            guard let self, projects[projectID] != nil else { return }
            setProjectTasks(projectID, result.tasks)
        }
    }
}

/// How a state of agent work looks wherever it is drawn: the sub-agent list, a task's mark and a subagent row.
enum AgentWorkLook {
    case running, done, failed, stopped

    /// A task that never settled is work in progress; the rest each have a look of their own.
    init(taskStatus: TaskStatus) {
        switch taskStatus {
        case .open: self = .running
        case .done: self = .done
        case .failed: self = .failed
        case .cancelled: self = .stopped
        }
    }

    var color: Color { Color(uiColor: uiColor) }

    var uiColor: UIColor {
        switch self {
        case .running: MobileStyle.statusRunningColor
        case .done: MobileStyle.statusIdleColor
        case .failed: MobileStyle.statusErrorColor
        case .stopped: MobileStyle.faintColor
        }
    }
}

/// The mark a node wears when another agent opened it with a task. Nothing to press; the thread of the chat that gave
/// the task is where its result is read.
struct TaskMark: View {
    let task: AgentTask

    static func word(_ status: TaskStatus) -> String {
        switch status {
        case .open: String(localized: "working on it", comment: "Status of a task an agent gave")
        case .done: String(localized: "done", comment: "Status of a task an agent gave")
        case .failed: String(localized: "failed", comment: "Status of a task an agent gave")
        case .cancelled: String(localized: "canceled", comment: "Status of a task an agent gave")
        }
    }

    var body: some View {
        let status = task.status
        let icon =
            switch status {
            case .open: "circle-dashed"
            case .done: "circle-check"
            case .failed: "circle-x"
            case .cancelled: "circle-slash"
            }
        Image(lucide: icon, size: 14)
            .foregroundStyle(AgentWorkLook(taskStatus: status).color)
            .accessibilityElement()
            .accessibilityLabel("Task: \(task.title), \(Self.word(status))")
    }
}
