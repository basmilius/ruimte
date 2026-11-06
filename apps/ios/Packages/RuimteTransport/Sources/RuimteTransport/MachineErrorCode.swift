import Foundation

/// The codes of a machine's refusal that the app acts on. Hand-written: the daemon's modules define them and no
/// contract lists them, so a code the daemon renames stops matching here without a build failing.
public enum MachineErrorCode: String, Sendable {
    case revConflict = "rev-conflict"
}

extension MachineClientError {
    /// The code a machine sent, when it is one the app knows.
    public var code: MachineErrorCode? {
        guard case .server(let code, _) = self else { return nil }
        return MachineErrorCode(rawValue: code)
    }
}
