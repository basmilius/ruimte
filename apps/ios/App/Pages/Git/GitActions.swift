import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What a person can be asked to confirm before it runs, and what the sheet for it says.
enum GitConfirmation: Identifiable {
    case discard(cwd: String, path: String)
    case forcePush(cwd: String)
    case deleteBranch(cwd: String, ref: String, force: Bool)
    case checkout(cwd: String, ref: String)

    var id: String {
        switch self {
        case .discard(let cwd, let path): "discard\u{0}\(cwd)\u{0}\(path)"
        case .forcePush(let cwd): "force-push\u{0}\(cwd)"
        case .deleteBranch(let cwd, let ref, let force): "delete\u{0}\(cwd)\u{0}\(ref)\u{0}\(force)"
        case .checkout(let cwd, let ref): "checkout\u{0}\(cwd)\u{0}\(ref)"
        }
    }

    var title: String {
        switch self {
        case .discard(_, let path): "Discard changes in \((path as NSString).lastPathComponent)?"
        case .forcePush: "Force push this branch?"
        case .deleteBranch(_, let ref, let force): force ? "Delete \(ref) anyway?" : "Delete \(ref)?"
        case .checkout(_, let ref): "Switch to \(ref)?"
        }
    }

    var detail: String {
        switch self {
        case .discard: "The file goes back to what it was, and git keeps a stash to undo it with."
        case .forcePush: "The remote branch is replaced by this one. Commits only it has are lost."
        case .deleteBranch(_, _, let force):
            force ? "This branch has not been merged anywhere. Its commits are only reachable by hash." : "The branch is removed here; the remote keeps its own."
        case .checkout: "Changes in the working tree are stashed first, so nothing is lost."
        }
    }

    var confirmLabel: String {
        switch self {
        case .discard: "Discard"
        case .forcePush: "Force push"
        case .deleteBranch: "Delete"
        case .checkout: "Switch"
        }
    }
}

extension GitRepositories {
    /// One action on one repository. The lines git writes while it runs land in `progress`, so a slow
    /// push says where it is instead of freezing a button.
    @discardableResult func act(
        client: any MachineRequesting, cwd: String, kind: String, extra: [String: JSONValue] = [:]
    ) async -> JSONValue? {
        guard !busy else { return nil }
        busy = true
        defer {
            busy = false
            progress = nil
        }
        switch await perform(client: client, cwd: cwd, kind: kind, extra: extra) {
        case .success(let result):
            problem = nil
            await refresh(client: client, cwd: cwd)
            return result
        case .failure(let error):
            problem = message(of: error)
            await refresh(client: client, cwd: cwd)
            return nil
        }
    }

    /// Every repository in order, never two at once: a folder of nine pushes over one link. A repository
    /// that fails does not stop the run, so the end is the only place the whole outcome can be read.
    func actAll(client: any MachineRequesting, kind: String) async {
        guard !busy, !checkouts.isEmpty else { return }
        busy = true
        defer {
            busy = false
            progress = nil
        }
        var failed: [String] = []
        for (index, checkout) in checkouts.enumerated() {
            step = "\(checkout.label) (\(index + 1)/\(checkouts.count))"
            if case .failure(let error) = await perform(client: client, cwd: checkout.path, kind: kind, extra: [:]) {
                failed.append("\(checkout.label): \(message(of: error))")
            }
        }
        step = nil
        problem = failed.isEmpty ? nil : failed.joined(separator: "\n")
        await refreshAll(client: client)
    }

    /// One message over every repository that has something staged: one commit each, the same words.
    func commit(
        client: any MachineRequesting, targets: [GitCheckout], subject: String, body: String, stageAll: Bool,
        push: Bool
    ) async -> Bool {
        guard !busy, !targets.isEmpty else { return false }
        busy = true
        defer {
            busy = false
            progress = nil
            step = nil
        }
        let kind = push ? "commit-push" : "commit"
        let extra: [String: JSONValue] = [
            "subject": .string(subject), "body": .string(body), "stageAll": .bool(stageAll),
        ]
        var failed: [String] = []
        for (index, target) in targets.enumerated() {
            step = targets.count > 1 ? "\(target.label) (\(index + 1)/\(targets.count))" : nil
            if case .failure(let error) = await perform(client: client, cwd: target.path, kind: kind, extra: extra) {
                failed.append("\(target.label): \(message(of: error))")
            }
        }
        problem = failed.isEmpty ? nil : failed.joined(separator: "\n")
        await refreshAll(client: client)
        return failed.isEmpty
    }

    /// Moves paths of one repository in or out of its index.
    func stage(client: any MachineRequesting, cwd: String, paths: [String], staged: Bool) async {
        guard !busy, !paths.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await client.request(
                "git.stage",
                payload: .object([
                    "cwd": .string(cwd), "paths": .array(paths.map { .string($0) }), "staged": .bool(staged),
                ]))
            problem = nil
        } catch {
            problem = message(of: error)
        }
        await refresh(client: client, cwd: cwd)
    }

    /// Throws away what a file holds, behind the stash git keeps to undo it with.
    func discard(client: any MachineRequesting, cwd: String, path: String) async -> String? {
        guard !busy else { return nil }
        busy = true
        defer { busy = false }
        var stash: String?
        do {
            let answer = try await client.request(
                "git.discard", payload: .object(["cwd": .string(cwd), "paths": .array([.string(path)])]))
            stash = answer["stash"]?.stringValue
            problem = nil
        } catch {
            problem = message(of: error)
        }
        await refresh(client: client, cwd: cwd)
        return stash
    }

    private func perform(
        client: any MachineRequesting, cwd: String, kind: String, extra: [String: JSONValue]
    ) async -> Result<JSONValue, any Error> {
        let actionId = UUID().uuidString
        let cancel = client.subscribe("git.progress") { [weak self] payload in
            guard payload.text("actionId") == actionId else { return }
            let line = payload.text("line")
            self?.progress = line.isEmpty ? payload.text("phase") : line
        }
        defer {
            cancel()
            progress = nil
        }
        var fields: [String: JSONValue] = [
            "cwd": .string(cwd), "actionId": .string(actionId), "kind": .string(kind),
        ]
        for (key, value) in extra { fields[key] = value }
        do {
            return .success(try await client.request("git.action", payload: .object(fields)))
        } catch {
            return .failure(error)
        }
    }

    private func message(of error: any Error) -> String {
        error.localizedDescription
    }
}

/// Git refuses to delete a branch it has not merged anywhere; only that refusal earns a second ask.
func gitIsUnmergedRefusal(_ message: String) -> Bool { message.contains("not fully merged") }
