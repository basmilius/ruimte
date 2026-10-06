import Foundation

/// What happened to one stretch of a file between the version two sides started from and what each made
/// of it. Only `conflict` needs a person: the rest is one side's change, or the same change made twice.
enum MergeBlockKind: String, Equatable, Sendable {
    case stable, ours, theirs, both, conflict
}

struct MergeBlock: Equatable, Sendable {
    let kind: MergeBlockKind
    let base: [String]
    let ours: [String]
    let theirs: [String]
}

/// One stretch where two versions of a file differ, `end` exclusive on both sides.
struct MergeChange: Equatable, Sendable {
    var baseStart: Int
    var baseEnd: Int
    var otherStart: Int
    var otherEnd: Int
}

/// The line ending a file uses and whether its last line is ended, so a resolution does not rewrite the file.
struct MergeTextShape: Equatable, Sendable {
    let eol: String
    let finalNewline: Bool
}

/// A port of `@adecore/merge`. The daemon answers `git.resolveAi` by block index and fingerprint, so the
/// split here has to come out exactly as the TypeScript one does, tie-breaks of the diff included.
enum ThreeWayMerge {
    private static let maxDistance = 4000
    /// The walk keeps every `stride`-th state and walks the rounds between two again on the way back.
    private static let stride = 64

    /// The lines of a file split on `\n` and `\r\n`, without the empty one a trailing newline leaves.
    /// Read per scalar, since a Swift `Character` holds `\r\n` as one.
    static func splitLines(_ text: String) -> [String] {
        if text.isEmpty { return [] }
        var lines: [String] = []
        var current = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            if scalar == "\n" {
                if current.last == "\r" { current.removeLast() }
                lines.append(String(current))
                current = String.UnicodeScalarView()
            } else {
                current.append(scalar)
            }
        }
        lines.append(String(current))
        if lines.last == "" { lines.removeLast() }
        return lines
    }

    static func shapeOf(_ text: String) -> MergeTextShape {
        let scalars = Array(text.unicodeScalars)
        let newline = scalars.firstIndex(of: "\n")
        let crlf = newline.map { $0 > 0 && scalars[$0 - 1] == "\r" } ?? false
        return MergeTextShape(eol: crlf ? "\r\n" : "\n", finalNewline: scalars.isEmpty || scalars.last == "\n")
    }

    static func joinLines(_ lines: [String], shape: MergeTextShape) -> String {
        if lines.isEmpty { return "" }
        return lines.joined(separator: shape.eol) + (shape.finalNewline ? shape.eol : "")
    }

    /// Where `other` differs from `base`, in line stretches, in the order they appear.
    static func diffLines(_ base: [String], _ other: [String]) -> [MergeChange] {
        var table: [[UInt8]: Int] = [:]
        return diff(intern(base, &table), intern(other, &table))
    }

    /// Lines as numbers by their UTF-8 bytes: JavaScript compares code units, and Swift's `==` would call
    /// two spellings of the same accented letter equal where the daemon does not.
    private static func intern(_ lines: [String], _ table: inout [[UInt8]: Int]) -> [Int] {
        lines.map { line in
            let key = Array(line.utf8)
            if let known = table[key] { return known }
            let id = table.count
            table[key] = id
            return id
        }
    }

    private static func diff(_ base: [Int], _ other: [Int]) -> [MergeChange] {
        var prefix = 0
        while prefix < base.count && prefix < other.count && base[prefix] == other[prefix] {
            prefix += 1
        }
        var suffix = 0
        while suffix < base.count - prefix && suffix < other.count - prefix
            && base[base.count - 1 - suffix] == other[other.count - 1 - suffix]
        {
            suffix += 1
        }
        let left = Array(base[prefix..<(base.count - suffix)])
        let right = Array(other[prefix..<(other.count - suffix)])
        if left.isEmpty && right.isEmpty { return [] }
        let moves = left.isEmpty || right.isEmpty ? nil : walk(left, right)
        let changes =
            moves.map(changesOf)
            ?? [MergeChange(baseStart: 0, baseEnd: left.count, otherStart: 0, otherEnd: right.count)]
        return changes.map {
            MergeChange(
                baseStart: $0.baseStart + prefix, baseEnd: $0.baseEnd + prefix, otherStart: $0.otherStart + prefix,
                otherEnd: $0.otherEnd + prefix)
        }
    }

    private struct Move {
        let prevX: Int
        let prevY: Int
        let x: Int
        let y: Int
    }

    /// One round of Myers' walk: every diagonal of this distance taken as far as its lines match.
    private static func extend(_ left: [Int], _ right: [Int], _ reach: inout [Int], _ offset: Int, _ distance: Int) -> Bool {
        var diagonal = -distance
        while diagonal <= distance {
            let down =
                diagonal == -distance
                || (diagonal != distance && reach[offset + diagonal - 1] < reach[offset + diagonal + 1])
            var x = down ? reach[offset + diagonal + 1] : reach[offset + diagonal - 1] + 1
            var y = x - diagonal
            while x < left.count && y < right.count && left[x] == right[y] {
                x += 1
                y += 1
            }
            reach[offset + diagonal] = x
            if x >= left.count && y >= right.count { return true }
            diagonal += 2
        }
        return false
    }

    private static func backtrack(_ left: [Int], _ right: [Int], _ saved: [[Int]], _ distance: Int, _ offset: Int) -> [Move] {
        var moves: [Move] = []
        var x = left.count
        var y = right.count
        var states = Array(repeating: [Int](repeating: 0, count: 2 * offset + 1), count: min(distance, stride) + 1)
        var step = distance
        while step > 0 {
            let first = (step - 1) / stride * stride
            states[0] = saved[first / stride]
            for round in first..<step {
                var next = states[round - first]
                _ = extend(left, right, &next, offset, round)
                states[round - first + 1] = next
            }
            while step > first {
                let state = states[step - first]
                let diagonal = x - y
                let down =
                    diagonal == -step
                    || (diagonal != step && state[offset + diagonal - 1] < state[offset + diagonal + 1])
                let previous = down ? diagonal + 1 : diagonal - 1
                let prevX = state[offset + previous]
                let prevY = prevX - previous
                moves.append(Move(prevX: prevX, prevY: prevY, x: x, y: y))
                x = prevX
                y = prevY
                step -= 1
            }
        }
        return moves.reversed()
    }

    private static func walk(_ left: [Int], _ right: [Int]) -> [Move]? {
        let limit = min(left.count + right.count, maxDistance)
        let offset = limit
        var reach = [Int](repeating: 0, count: 2 * limit + 1)
        var saved: [[Int]] = []
        for distance in 0...limit {
            if distance % stride == 0 { saved.append(reach) }
            if extend(left, right, &reach, offset, distance) {
                return backtrack(left, right, saved, distance, offset)
            }
        }
        return nil
    }

    /// The stretches the moves cover, with edits that follow each other straight away folded into one.
    private static func changesOf(_ moves: [Move]) -> [MergeChange] {
        var changes: [MergeChange] = []
        var current: MergeChange?
        for move in moves {
            let deleted = move.x - move.y > move.prevX - move.prevY
            let editX = deleted ? move.prevX + 1 : move.prevX
            let editY = deleted ? move.prevY : move.prevY + 1
            if var open = current, open.baseEnd == move.prevX, open.otherEnd == move.prevY {
                open.baseEnd = editX
                open.otherEnd = editY
                current = open
            } else {
                if let open = current { changes.append(open) }
                current = MergeChange(baseStart: move.prevX, baseEnd: editX, otherStart: move.prevY, otherEnd: editY)
            }
            if move.x != editX || move.y != editY, let open = current {
                changes.append(open)
                current = nil
            }
        }
        if let open = current { changes.append(open) }
        return changes
    }

    /// The three versions as the stretches they agree and disagree on, in reading order. Two changes are
    /// one stretch only where they overlap in the base or add in exactly the same place.
    static func splitBlocks(base: [String], ours: [String], theirs: [String]) -> [MergeBlock] {
        var table: [[UInt8]: Int] = [:]
        let baseIDs = intern(base, &table)
        let ourIDs = intern(ours, &table)
        let theirIDs = intern(theirs, &table)
        let ourChanges = diff(baseIDs, ourIDs)
        let theirChanges = diff(baseIDs, theirIDs)
        var blocks: [MergeBlock] = []
        var baseAt = 0
        var ourAt = 0
        var theirAt = 0
        var ourNext = 0
        var theirNext = 0

        func push(_ baseEnd: Int, _ ourEnd: Int, _ theirEnd: Int) {
            if baseEnd > baseAt || ourEnd > ourAt || theirEnd > theirAt {
                let kind = kindOf(
                    base: baseIDs[baseAt..<baseEnd], ours: ourIDs[ourAt..<ourEnd], theirs: theirIDs[theirAt..<theirEnd])
                blocks.append(
                    MergeBlock(
                        kind: kind, base: Array(base[baseAt..<baseEnd]), ours: Array(ours[ourAt..<ourEnd]),
                        theirs: Array(theirs[theirAt..<theirEnd])))
            }
            baseAt = baseEnd
            ourAt = ourEnd
            theirAt = theirEnd
        }

        func reaches(_ change: MergeChange?, _ end: Int) -> Bool {
            guard let change else { return false }
            return change.baseStart <= end && (change.baseStart < end || end == baseAt)
        }

        while ourNext < ourChanges.count || theirNext < theirChanges.count {
            let start = min(
                ourNext < ourChanges.count ? ourChanges[ourNext].baseStart : Int.max,
                theirNext < theirChanges.count ? theirChanges[theirNext].baseStart : Int.max)
            if start > baseAt {
                let length = start - baseAt
                push(start, ourAt + length, theirAt + length)
            }
            var end = baseAt
            var ourGrowth = 0
            var theirGrowth = 0
            var taken = true
            while taken {
                taken = false
                while reaches(ourNext < ourChanges.count ? ourChanges[ourNext] : nil, end) {
                    let change = ourChanges[ourNext]
                    end = max(end, change.baseEnd)
                    ourGrowth += delta(change)
                    ourNext += 1
                    taken = true
                }
                while reaches(theirNext < theirChanges.count ? theirChanges[theirNext] : nil, end) {
                    let change = theirChanges[theirNext]
                    end = max(end, change.baseEnd)
                    theirGrowth += delta(change)
                    theirNext += 1
                    taken = true
                }
            }
            push(end, ourAt + (end - baseAt) + ourGrowth, theirAt + (end - baseAt) + theirGrowth)
        }
        push(base.count, ours.count, theirs.count)
        return blocks
    }

    /// How far a change moves everything after it.
    private static func delta(_ change: MergeChange) -> Int {
        change.otherEnd - change.otherStart - (change.baseEnd - change.baseStart)
    }

    private static func kindOf(base: ArraySlice<Int>, ours: ArraySlice<Int>, theirs: ArraySlice<Int>) -> MergeBlockKind {
        if ours.elementsEqual(theirs) { return base.elementsEqual(ours) ? .stable : .both }
        if base.elementsEqual(ours) { return .theirs }
        if base.elementsEqual(theirs) { return .ours }
        return .conflict
    }

    /// What a block is worth without anyone choosing: the side that changed, or the change both made.
    static func autoLines(_ block: MergeBlock) -> [String]? {
        switch block.kind {
        case .stable, .ours, .both: block.ours
        case .theirs: block.theirs
        case .conflict: nil
        }
    }

    static func bothLines(_ block: MergeBlock, oursFirst: Bool) -> [String] {
        oursFirst ? block.ours + block.theirs : block.theirs + block.ours
    }

    /// What the wand makes of a conflict, or nil for one that needs a person: sides that differ only in
    /// whitespace inside or after a line, and a side that already holds every line of the other without
    /// putting back what the other deleted.
    static func wandLines(_ block: MergeBlock) -> [String]? {
        guard block.kind == .conflict else { return autoLines(block) }
        if squashed(block.ours) == squashed(block.theirs) { return block.ours }
        if covers(base: block.base, outer: block.ours, inner: block.theirs) { return block.ours }
        if covers(base: block.base, outer: block.theirs, inner: block.ours) { return block.theirs }
        return nil
    }

    /// Indentation is meaning in Python, YAML or a Makefile, so only a blank line loses its own. Joined
    /// as the TypeScript is, where no lines and one blank line read the same.
    private static func squashed(_ lines: [String]) -> [UInt8] {
        let squashedLines = lines.map { line -> [UInt8] in
            let scalars = Array(line.unicodeScalars)
            let isSpace = { (scalar: Unicode.Scalar) in CharacterSet.whitespacesAndNewlines.contains(scalar) }
            guard let first = scalars.firstIndex(where: { !isSpace($0) }),
                let last = scalars.lastIndex(where: { !isSpace($0) })
            else { return [] }
            var out = String.UnicodeScalarView(scalars[..<first])
            var spacing = false
            for scalar in scalars[first...last] {
                if isSpace(scalar) {
                    spacing = true
                    continue
                }
                if spacing { out.append(" ") }
                spacing = false
                out.append(scalar)
            }
            return Array(String(out).utf8)
        }
        return Array(squashedLines.joined(separator: [10]))
    }

    private static func same(_ left: String, _ right: String) -> Bool { left.utf8.elementsEqual(right.utf8) }

    private static func covers(base: [String], outer: [String], inner: [String]) -> Bool {
        guard !inner.isEmpty, inner.count <= outer.count else { return false }
        guard
            let start = (0...(outer.count - inner.count)).first(where: { start in
                inner.indices.allSatisfy { same(outer[start + $0], inner[$0]) }
            })
        else { return false }
        let added = Array(outer[..<start]) + Array(outer[(start + inner.count)...])
        return added.allSatisfy { line in
            !base.contains { same($0, line) } || inner.contains { same($0, line) }
        }
    }

    /// FNV-1a over the UTF-16 code units of both sides, as `@adecore/merge` writes it, so an answer the
    /// daemon wrote for a block can be checked against the block it lands on.
    static func fingerprint(_ block: MergeBlock) -> String {
        var hash: UInt32 = 0x811c_9dc5
        for line in block.ours + ["\u{0}"] + block.theirs {
            for unit in line.utf16 {
                hash = (hash ^ UInt32(unit)) &* 0x0100_0193
            }
            hash = (hash ^ 0x0a) &* 0x0100_0193
        }
        let hex = String(hash, radix: 16)
        return String(repeating: "0", count: max(0, 8 - hex.count)) + hex
    }
}
