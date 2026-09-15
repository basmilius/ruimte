import Foundation
import RuimtePulsar

extension JSONValue {
    func text(_ key: String, fallback: String = "") -> String { self[key]?.stringValue ?? fallback }
    func list(_ key: String) -> [JSONValue] { self[key]?.arrayValue ?? [] }
    func number(_ key: String, fallback: Double = 0) -> Double { self[key]?.numberValue ?? fallback }
    func setting(_ key: String, _ value: JSONValue?) -> JSONValue {
        var object = objectValue ?? [:]
        object[key] = value
        return .object(object)
    }
    var stableID: String { text("id", fallback: text("projectId", fallback: text("path"))) }
}

struct WorkspaceConflict: LocalizedError {
    let path: String
    var errorDescription: String? {
        "This changed both here and on the machine: \(path). Review the other version before saving."
    }
}

enum MobileProjectMerge {
    static func merge(base: JSONValue?, local: JSONValue?, remote: JSONValue?, path: String = "project") throws
        -> JSONValue?
    {
        if local == remote || remote == base { return local }
        if local == base { return remote }
        guard let base, let local, let remote else { throw WorkspaceConflict(path: path) }
        if base["kind"] == .string("unknown") || local["kind"] == .string("unknown")
            || remote["kind"] == .string("unknown")
        {
            throw WorkspaceConflict(path: path)
        }
        if let before = base.objectValue, let mine = local.objectValue, let theirs = remote.objectValue {
            var result: [String: JSONValue] = [:]
            for key in Set(before.keys).union(mine.keys).union(theirs.keys) {
                if path == "project" && (key == "rev" || key == "version") {
                    result[key] = theirs[key]
                    continue
                }
                result[key] = try merge(
                    base: before[key], local: mine[key], remote: theirs[key], path: "\(path).\(key)")
            }
            return .object(result)
        }
        if let before = base.arrayValue, let mine = local.arrayValue, let theirs = remote.arrayValue,
            (before + mine + theirs).allSatisfy({ !$0.stableID.isEmpty })
        {
            guard [before, mine, theirs].allSatisfy({ Set($0.map(\.stableID)).count == $0.count }) else {
                throw WorkspaceConflict(path: path + " duplicate IDs")
            }
            let beforeMap = Dictionary(uniqueKeysWithValues: before.map { ($0.stableID, $0) })
            let mineMap = Dictionary(uniqueKeysWithValues: mine.map { ($0.stableID, $0) })
            let theirMap = Dictionary(uniqueKeysWithValues: theirs.map { ($0.stableID, $0) })
            var values: [String: JSONValue] = [:]
            for key in Set(beforeMap.keys).union(mineMap.keys).union(theirMap.keys) {
                values[key] = try merge(
                    base: beforeMap[key], local: mineMap[key], remote: theirMap[key], path: "\(path)[\(key)]")
            }
            let shared = Set(beforeMap.keys).intersection(mineMap.keys).intersection(theirMap.keys)
            let baseOrder = before.map(\.stableID).filter(shared.contains)
            let mineOrder = mine.map(\.stableID).filter(shared.contains)
            let theirOrder = theirs.map(\.stableID).filter(shared.contains)
            if mineOrder != baseOrder && theirOrder != baseOrder && mineOrder != theirOrder {
                throw WorkspaceConflict(path: path + " order")
            }
            let primary = theirOrder != baseOrder ? theirs : mine
            let secondary = theirOrder != baseOrder ? mine : theirs
            var order = primary.map(\.stableID).filter { values[$0] != nil }
            var predecessor: String?
            for value in secondary where values[value.stableID] != nil {
                let id = value.stableID
                if !order.contains(id) {
                    let offset = predecessor.flatMap { order.firstIndex(of: $0) }.map { $0 + 1 } ?? 0
                    order.insert(id, at: offset)
                }
                predecessor = id
            }
            return .array(order.compactMap { values[$0] })
        }
        throw WorkspaceConflict(path: path)
    }
}
