import Foundation

/// The codes of a machine's refusal that the app acts on. Hand-written: the daemon's modules define them and no
/// contract lists them, so a code the daemon renames stops matching here without a build failing. An older machine
/// sends fewer of them, and one the app does not know reads as nil.
public enum MachineErrorCode: String, Sendable {
    /// What a machine says in `direct.refused` and in a closing signal when it does not know the device.
    case notPaired = "not-paired"
    /// A machine that takes no statement from this device.
    case statementsRefused = "statements-refused"
    case revConflict = "rev-conflict"
    case requestNotFound = "request-not-found"
    case notFound = "not-found"
    case stale
    case cancelled
    case sessionExists = "session-exists"
    case scratchUnavailable = "scratch-unavailable"
    case historyExpired = "history-expired"
    /// Made by the app itself for a chat whose machine is not the one connected.
    case wrongMachine = "wrong-machine"
    case terminalPrepareRefused = "terminal-prepare-refused"
    case terminalEditorRefused = "terminal-editor-refused"
    case terminalPrepareUnconfirmed = "terminal-prepare-unconfirmed"
    case updateNoApp = "update-no-app"
    case updateNone = "update-none"
    case streamingDisabled = "streaming-disabled"
    case deviceFormatUnsupported = "device-format-unsupported"
    case deviceNotBooted = "device-not-booted"
    case deviceNotFound = "device-not-found"
    case deviceCaptureUnavailable = "device-capture-unavailable"
    case platformUnavailable = "platform-unavailable"
    case gitFailed = "git-failed"
    /// git refused to merge over a changed file of the person's, which a stash moves out of the way.
    case mergeWouldOverwrite = "merge-would-overwrite"
    /// git refused to delete a branch it has not merged anywhere; a person can still force it.
    case branchNotMerged = "branch-not-merged"
    case targetNotCheckedOut = "target-not-checked-out"
    case targetBusy = "target-busy"
    case targetDirty = "target-dirty"
    case worktreeBusy = "worktree-busy"
    case worktreeHasWork = "worktree-has-work"
    case worktreeLocked = "worktree-locked"
    case agentWorking = "agent-working"
}

extension MachineClientError {
    /// The code a machine sent, when it is one the app knows.
    public var code: MachineErrorCode? {
        guard case .server(let code, _) = self else { return nil }
        return MachineErrorCode(rawValue: code)
    }
}

extension Error {
    /// The known code of a machine's refusal; nil for any other failure.
    public var machineCode: MachineErrorCode? { (self as? MachineClientError)?.code }
}
