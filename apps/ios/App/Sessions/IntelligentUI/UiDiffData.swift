import Foundation
import RuimtePulsar

/// What a Diff with `open` shows: the chip it is without a machine that reads diffs, or the change once it is read.
enum UiOpenDiff: Equatable {
    case chip
    case reading
    case patch(String, partial: Bool)
    case refused(String)

    /// The open Diffs one block asks its machine for, as the desktop's `UI_OPEN_DIFFS`, so no block reads a whole
    /// repository.
    static let limit = 8
    /// The lines of change and context a block shows, as the desktop's `UI_DIFF_LINES`.
    static let lines = 200

    static func asks(_ node: UiNode) -> Bool { node.type == "Diff" && node.bool("open") == true }

    /// The first `limit` open Diffs of a block that closed without an error, in the order they were written.
    static func wanted(_ nodes: [UiNode]) -> [String] {
        var ids: [String] = []
        func visit(_ nodes: [UiNode]) {
            for node in nodes {
                if asks(node), node.error == nil, node.complete { ids.append(node.id) }
                visit(node.children)
            }
        }
        visit(nodes)
        return Array(ids.prefix(limit))
    }

    /// `wanted` says whether the machine is asked for this Diff at all; `reading` is its answer, nil until it came.
    static func of(wanted: Bool, reading: JSONValue?) -> Self {
        guard wanted else { return .chip }
        guard let reading else { return .reading }
        guard reading["state"] == .string("patch"), let patch = reading["patch"]?.stringValue else {
            return .refused(UiReason.text(reading) ?? String(localized: "Could not read this diff"))
        }
        let clipped = UiPatch.clip(patch, limit: lines)
        return .patch(clipped.patch, partial: clipped.clipped || reading["truncated"]?.boolValue == true)
    }
}

enum UiPatch {
    private struct Hunk {
        /// Where its header stands in the kept lines.
        let at: Int
        let oldStart: Int
        let newStart: Int
        /// The counts its header was written with.
        let oldWritten: Int
        let newWritten: Int
        let rest: String
        var old = 0
        var new = 0

        var header: String {
            "@@ -\(Self.side(oldStart, old, oldWritten)) +\(Self.side(newStart, new, newWritten)) @@\(rest)"
        }

        /// A side the cut left without lines names the line before it, as a hunk that never had lines on that side.
        private static func side(_ start: Int, _ count: Int, _ written: Int) -> String {
            "\(count == 0 && written > 0 ? max(0, start - 1) : start),\(count)"
        }
    }

    /// A unified patch cut to its first `limit` lines of change and context, as `uiClipPatch` in
    /// `@adecore/agents-react` cuts it. The file header stays, and the hunk the cut falls in gets the counts of what
    /// is left of it, so the shorter patch still reads as a whole one.
    static func clip(_ patch: String, limit: Int) -> (patch: String, clipped: Bool) {
        let lines = patch.components(separatedBy: "\n")
        var kept: [String] = []
        var hunk: Hunk?
        var count = 0
        for (index, line) in lines.enumerated() {
            if let header = line.wholeMatch(of: /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/) {
                if count >= limit { return (kept.joined(separator: "\n"), true) }
                hunk = Hunk(
                    at: kept.count, oldStart: Int(header.1) ?? 0, newStart: Int(header.3) ?? 0,
                    oldWritten: header.2.flatMap { Int($0) } ?? 1, newWritten: header.4.flatMap { Int($0) } ?? 1,
                    rest: String(header.5))
                kept.append(line)
                continue
            }
            // A stripped empty line inside a hunk is context; the one a final newline leaves at the very end is not.
            let body = line.first.map { " +-".contains($0) } ?? (index < lines.count - 1)
            guard var open = hunk, body || line.hasPrefix("\\") else {
                hunk = nil
                kept.append(line)
                continue
            }
            guard body else {
                kept.append(line)
                continue
            }
            if count >= limit {
                kept[open.at] = open.header
                return (kept.joined(separator: "\n"), true)
            }
            open.old += line.hasPrefix("+") ? 0 : 1
            open.new += line.hasPrefix("-") ? 0 : 1
            hunk = open
            count += 1
            kept.append(line)
        }
        return (patch, false)
    }
}
