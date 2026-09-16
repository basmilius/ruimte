import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// The tasks a machine keeps for the projects open on this device: what a chat asked of a node it opened with
/// `--task`. The machine tells every connection about every task it writes; a connection that opens asks once per
/// open project, since what changed while it was closed was told to nobody.
@MainActor @Observable
final class TaskStore {
    private(set) var tasks: [String: JSONValue] = [:]
    @ObservationIgnored private var projects: [String: Int] = [:]
    @ObservationIgnored private var subscriptions: [() -> Void] = []
    @ObservationIgnored private let client: any MachineRequesting

    init(client: any MachineRequesting) { self.client = client }

    func start() {
        guard subscriptions.isEmpty else { return }
        subscriptions = [
            client.subscribe("task.changed") { [weak self] event in
                guard let task = event["task"] else { return }
                self?.put(task)
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
    func setProjectTasks(_ projectID: String, _ list: [JSONValue]) {
        var next = tasks.filter { $0.value.text("projectId") != projectID }
        for task in list where !task.text("id").isEmpty { next[task.text("id")] = task }
        if next != tasks { tasks = next }
    }

    func put(_ task: JSONValue) {
        let id = task.text("id")
        guard !id.isEmpty, tasks[id] != task else { return }
        tasks[id] = task
    }

    func task(_ id: String) -> JSONValue? { tasks[id] }

    /// The newest task a node was opened with, since a node given a task twice shows the one it works on now.
    func childTask(_ childID: String) -> JSONValue? {
        tasks.values.filter { $0.text("childId") == childID }.max { $0.number("createdAt") < $1.number("createdAt") }
    }

    private func ask(_ projectID: String) {
        Task { [weak self, client] in
            // A machine from before tasks does not know the request; it simply has none.
            guard
                let result = try? await client.request("task.list", payload: .object(["projectId": .string(projectID)]))
            else { return }
            guard let self, projects[projectID] != nil else { return }
            setProjectTasks(projectID, result.list("tasks"))
        }
    }
}

/// How a state of agent work looks wherever it is drawn: the sub-agent list, a task's mark and a subagent row.
enum AgentWorkLook {
    case running, done, failed, stopped

    init(taskStatus: String) {
        switch taskStatus {
        case "done": self = .done
        case "failed": self = .failed
        case "cancelled": self = .stopped
        default: self = .running
        }
    }

    var color: Color {
        switch self {
        case .running: .blue
        case .done: .green
        case .failed: .red
        case .stopped: MobileStyle.faint
        }
    }

    var uiColor: UIColor {
        switch self {
        case .running: .systemBlue
        case .done: .systemGreen
        case .failed: .systemRed
        case .stopped: .tertiaryLabel
        }
    }
}

/// The mark a node wears when another agent opened it with a task. Nothing to press; the thread of the chat that gave
/// the task is where its result is read.
struct TaskMark: View {
    let task: JSONValue

    static func word(_ status: String) -> String {
        switch status {
        case "done": "done"
        case "failed": "failed"
        case "cancelled": "cancelled"
        default: "working on it"
        }
    }

    var body: some View {
        let status = task.text("status")
        let icon =
            switch status {
            case "done": "list-checks"
            case "failed": "circle-x"
            case "cancelled": "circle-slash"
            default: "circle-dashed"
            }
        Image(lucide: icon, size: 14)
            .foregroundStyle(AgentWorkLook(taskStatus: status).color)
            .accessibilityElement()
            .accessibilityLabel("Task: \(task.text("title")), \(Self.word(status))")
    }
}
