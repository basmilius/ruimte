import Foundation
import RuimtePulsar

public enum UiLinkDestination: Equatable, Sendable {
    case file(path: String, line: Int?)
    case diff(cwd: String, path: String, staged: Bool, conflicted: Bool)
    case commit(cwd: String, sha: String)
    case node(viewID: String, nodeID: String)

    public static func parse(_ reading: JSONValue, projectID: String?) -> Self? {
        guard reading["state"] == .string("chip"), let projectID,
            reading["projectId"] == .string(projectID), let target = reading["target"]
        else { return nil }
        switch target["type"]?.stringValue {
        case "File":
            guard let path = target["path"]?.stringValue, !path.isEmpty else { return nil }
            var line: Int?
            if let value = target["line"]?.numberValue {
                guard value.isFinite, value > 0, value < Double(Int.max), value.rounded() == value else { return nil }
                line = Int(value)
            }
            return .file(path: path, line: line)
        case "Diff":
            guard let cwd = reading["cwd"]?.stringValue, !cwd.isEmpty,
                let path = reading["relativePath"]?.stringValue, !path.isEmpty
            else { return nil }
            return .diff(cwd: cwd, path: path, staged: reading["staged"]?.boolValue == true, conflicted: reading["conflicted"]?.boolValue == true)
        case "Commit":
            guard let cwd = reading["cwd"]?.stringValue, !cwd.isEmpty,
                let sha = target["sha"]?.stringValue, sha.range(of: "^[a-fA-F0-9]{7,64}$", options: .regularExpression) != nil
            else { return nil }
            return .commit(cwd: cwd, sha: sha)
        case "Node":
            guard let viewID = reading["viewId"]?.stringValue, !viewID.isEmpty,
                let nodeID = target["id"]?.stringValue, !nodeID.isEmpty
            else { return nil }
            return .node(viewID: viewID, nodeID: nodeID)
        default: return nil
        }
    }

    public static func externalURL(_ address: String) -> URL? {
        guard address.utf8.count <= 16384, let url = URL(string: address),
            ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil
        else { return nil }
        return url
    }
}
