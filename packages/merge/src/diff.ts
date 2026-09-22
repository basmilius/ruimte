/*
 * One stretch where two versions of a file differ: the lines it covers on each side, `end` exclusive.
 * An insert covers no line on the base side, a delete none on the other.
 */
export interface Change {
    baseStart: number;
    baseEnd: number;
    otherStart: number;
    otherEnd: number;
}

/*
 * How far apart two files may be before the exact walk costs more than the answer is worth. Past
 * this the two are answered as one stretch that differs whole, which reads as a single conflict
 * instead of a list nobody would work through anyway.
 */
const MAX_DISTANCE = 4000;

/* One edit and the run of equal lines behind it, as the walk found them. */
interface Move {
    prevX: number;
    prevY: number;
    x: number;
    y: number;
}

/* The path back from the far corner, one edit per step, in the order the file reads. */
const backtrack = (trace: readonly Int32Array[], distance: number, offset: number, width: number, height: number): Move[] => {
    const moves: Move[] = [];
    let x = width;
    let y = height;
    for (let step = distance; step > 0; step -= 1) {
        const reach = trace[step]!;
        const diagonal = x - y;
        const down = diagonal === -step || (diagonal !== step && reach[offset + diagonal - 1]! < reach[offset + diagonal + 1]!);
        const previous = down ? diagonal + 1 : diagonal - 1;
        const prevX = reach[offset + previous]!;
        const prevY = prevX - previous;
        moves.push({ prevX, prevY, x, y });
        x = prevX;
        y = prevY;
    }
    return moves.reverse();
};

/*
 * Myers' greedy walk: for every edit distance it keeps the furthest reach on each diagonal, and the
 * state each round started in, which is the trace the path is read back from once the far corner is
 * reached. Null once the distance passes what is worth walking.
 */
const walk = (left: readonly string[], right: readonly string[]): Move[] | null => {
    const limit = Math.min(left.length + right.length, MAX_DISTANCE);
    const offset = limit;
    const reach = new Int32Array(2 * limit + 1);
    const trace: Int32Array[] = [];
    for (let distance = 0; distance <= limit; distance += 1) {
        trace.push(reach.slice());
        for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
            const down = diagonal === -distance || (diagonal !== distance && reach[offset + diagonal - 1]! < reach[offset + diagonal + 1]!);
            let x = down ? reach[offset + diagonal + 1]! : reach[offset + diagonal - 1]! + 1;
            let y = x - diagonal;
            while (x < left.length && y < right.length && left[x] === right[y]) {
                x += 1;
                y += 1;
            }
            reach[offset + diagonal] = x;
            if (x >= left.length && y >= right.length) {
                return backtrack(trace, distance, offset, left.length, right.length);
            }
        }
    }
    return null;
};

/* The stretches the moves cover, with edits that follow each other straight away folded into one. */
const changesOf = (moves: readonly Move[]): Change[] => {
    const changes: Change[] = [];
    let current: Change | null = null;
    for (const move of moves) {
        // A delete moves along the base side and so raises the diagonal; an insert lowers it.
        const deleted = move.x - move.y > move.prevX - move.prevY;
        const editX = deleted ? move.prevX + 1 : move.prevX;
        const editY = deleted ? move.prevY : move.prevY + 1;
        if (current !== null && current.baseEnd === move.prevX && current.otherEnd === move.prevY) {
            current.baseEnd = editX;
            current.otherEnd = editY;
        } else {
            if (current !== null) {
                changes.push(current);
            }
            current = { baseStart: move.prevX, baseEnd: editX, otherStart: move.prevY, otherEnd: editY };
        }
        // What follows the edit is a run of equal lines, which ends the stretch.
        if (move.x !== editX || move.y !== editY) {
            changes.push(current);
            current = null;
        }
    }
    if (current !== null) {
        changes.push(current);
    }
    return changes;
};

/* Where `other` differs from `base`, in line stretches, in the order they appear. */
export const diffLines = (base: readonly string[], other: readonly string[]): Change[] => {
    let prefix = 0;
    while (prefix < base.length && prefix < other.length && base[prefix] === other[prefix]) {
        prefix += 1;
    }
    let suffix = 0;
    while (suffix < base.length - prefix && suffix < other.length - prefix && base[base.length - 1 - suffix] === other[other.length - 1 - suffix]) {
        suffix += 1;
    }
    const left = base.slice(prefix, base.length - suffix);
    const right = other.slice(prefix, other.length - suffix);
    if (left.length === 0 && right.length === 0) {
        return [];
    }
    const moves = left.length === 0 || right.length === 0 ? null : walk(left, right);
    const changes = moves === null ? [{ baseStart: 0, baseEnd: left.length, otherStart: 0, otherEnd: right.length }] : changesOf(moves);
    return changes.map((change) => ({
        baseStart: change.baseStart + prefix,
        baseEnd: change.baseEnd + prefix,
        otherStart: change.otherStart + prefix,
        otherEnd: change.otherEnd + prefix
    }));
};
