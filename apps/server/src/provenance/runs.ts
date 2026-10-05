import { diffLines, type Change } from '@ruimte/merge';
import { PROVENANCE_LIMITS, type ProvenanceRun } from '@ruimte/contracts';
import { hashLine } from './line-hash.ts';

/* What the daemon keeps of one file: the lines it had when it last looked, as hashes, and the runs in those lines. */
export interface FileRecord {
    version: 1;
    path: string;
    lineHashes: string[];
    mtime: number;
    runs: ProvenanceRun[];
}

/* A run covers `start` through `end` (one-based, inclusive); one that only removed lines has `end` below `start` and marks the place they were. */
export function lineCount(run: Pick<ProvenanceRun, 'start' | 'end'>): number {
    return Math.max(0, run.end - run.start + 1);
}

/* Consecutive numbers as `[first, last]` pairs. */
function groupsOf(indices: readonly number[]): Array<[number, number]> {
    const groups: Array<[number, number]> = [];
    for (const index of indices) {
        const last = groups[groups.length - 1];
        if (last !== undefined && last[1] === index - 1) {
            last[1] = index;
        } else {
            groups.push([index, index]);
        }
    }
    return groups;
}

/* Where every line of the old text went; -1 for a line a change replaced or removed. */
function lineMap(oldLength: number, changes: readonly Change[]): Int32Array {
    const map = new Int32Array(oldLength);
    let shift = 0;
    let index = 0;
    for (const change of changes) {
        for (; index < change.baseStart; index++) {
            map[index] = index + shift;
        }
        for (; index < change.baseEnd; index++) {
            map[index] = -1;
        }
        shift += change.otherEnd - change.otherStart - (change.baseEnd - change.baseStart);
    }
    for (; index < oldLength; index++) {
        map[index] = index + shift;
    }
    return map;
}

/* The place between two lines of the old text, as the new text has it; -1 when a change cut through it. */
function pointMap(point: number, changes: readonly Change[]): number {
    let shift = 0;
    for (const change of changes) {
        if (change.baseEnd <= point) {
            shift += change.otherEnd - change.otherStart - (change.baseEnd - change.baseStart);
        } else if (change.baseStart < point) {
            return -1;
        }
    }
    return point + shift;
}

/*
 * A run cut into the stretches of its lines that `keep` still holds. The pieces keep the run's id, so a
 * review of it reaches all of them. Only a run that stayed whole keeps what it replaced.
 */
function pieces(run: ProvenanceRun, keepLine: (line: number) => number): ProvenanceRun[] {
    const kept: number[] = [];
    for (let line = run.start - 1; line < run.end; line++) {
        const place = keepLine(line);
        if (place >= 0) {
            kept.push(place);
        }
    }
    const groups = groupsOf(kept);
    const whole = groups.length === 1 && kept.length === lineCount(run);
    return groups.map(([first, last]) => {
        const { before, ...rest } = run;
        return { ...rest, ...(whole && before !== undefined ? { before } : {}), start: first + 1, end: last + 1 };
    });
}

/*
 * The runs of a file after its text went from `from` to `to`, both as line hashes. Lines a change
 * replaced or removed lose their run; lines inserted between two lines of a run are not part of it.
 */
export function mapRuns(runs: readonly ProvenanceRun[], from: readonly string[], to: readonly string[]): ProvenanceRun[] {
    const changes = diffLines(from, to);
    if (changes.length === 0) {
        return [...runs];
    }
    const map = lineMap(from.length, changes);
    return runs.flatMap((run) => {
        if (lineCount(run) === 0) {
            const point = pointMap(run.start - 1, changes);
            return point < 0 ? [] : [{ ...run, start: point + 1, end: point }];
        }
        return pieces(run, (line) => map[line] ?? -1);
    });
}

/*
 * Drops what a commit took over: a line the HEAD version of the file holds unchanged is git's to
 * attribute from here on. `head` is null for a file git does not hold, which keeps every run.
 */
export function dropCommitted(runs: readonly ProvenanceRun[], current: readonly string[], head: readonly string[] | null): ProvenanceRun[] {
    if (head === null) {
        return [...runs];
    }
    const changes = diffLines(head, current);
    const touched = new Uint8Array(current.length);
    for (const change of changes) {
        touched.fill(1, change.otherStart, change.otherEnd);
    }
    return runs.flatMap((run) => {
        if (lineCount(run) === 0) {
            const point = run.start - 1;
            const open = changes.some((change) => change.otherStart <= point && point <= change.otherEnd);
            return open ? [run] : [];
        }
        return pieces(run, (line) => (touched[line] === 1 ? line : -1));
    });
}

/* A hunk of the new text a write changed: its lines and the lines of the old text they replaced. */
export interface Hunk {
    /* Zero-based, `end` exclusive; both equal for a hunk that only removed lines. */
    start: number;
    end: number;
    baseStart: number;
    baseEnd: number;
    /* The ends were cut to the lines the tool wrote, so the old lines of the span are not the ones this hunk replaced. */
    trimmed?: boolean;
}

/* What a tool call says it wrote, as lines of text: a hunk only counts when it holds some of them. */
export interface WriteSignature {
    /* The tool replaced the whole file, so every hunk is its own. */
    all: boolean;
    blocks: Array<{ added: string[]; removed: string[] }>;
}

function isBlank(line: string): boolean {
    return line.trim() === '';
}

/*
 * The hunks of `next` against `previous` that the signature explains. Blank lines are in nearly every
 * write, so a hunk that matches only on those counts when nothing else matched or when it touches
 * a hunk that did.
 */
export function writtenHunks(
    previous: readonly string[],
    previousLines: readonly string[] | null,
    next: readonly string[],
    nextLines: readonly string[],
    signature: WriteSignature
): Hunk[] {
    const hunks = diffLines(previous, next).map((change) => ({
        start: change.otherStart,
        end: change.otherEnd,
        baseStart: change.baseStart,
        baseEnd: change.baseEnd
    }));
    if (signature.all) {
        return hunks;
    }
    const added = new Set(signature.blocks.flatMap((block) => block.added.map(hashLine)));
    const removed = new Set(signature.blocks.flatMap((block) => block.removed.map(hashLine)));
    const strong: Hunk[] = [];
    const weak: Hunk[] = [];
    for (const hunk of hunks) {
        const writtenLines = nextLines.slice(hunk.start, hunk.end);
        const replacedLines = previousLines === null ? [] : previousLines.slice(hunk.baseStart, hunk.baseEnd);
        const matchesAdded = writtenLines.some((line) => added.has(hashLine(line)));
        const matchesRemoved = replacedLines.some((line) => removed.has(hashLine(line)));
        // Without the old text a removal can only be told by its place, which only the added lines give.
        const matchesGone =
            previousLines === null && hunk.start === hunk.end && signature.blocks.some((block) => block.added.length === 0 && block.removed.length > 0);
        if (!matchesAdded && !matchesRemoved && !matchesGone) {
            continue;
        }
        const solid =
            writtenLines.some((line) => !isBlank(line) && added.has(hashLine(line))) ||
            replacedLines.some((line) => !isBlank(line) && removed.has(hashLine(line)));
        (solid ? strong : weak).push(hunk);
    }
    const accepted =
        strong.length === 0
            ? weak
            : [...strong, ...weak.filter((hunk) => strong.some((other) => hunk.start <= other.end + 1 && other.start <= hunk.end + 1))].sort(
                  (left, right) => left.start - right.start
              );
    return accepted.map((hunk) => trimmedTo(hunk, nextLines, added));
}

/* A change next to the tool's own lands in the same hunk; the lines at its ends that the tool did not write are not the tool's. */
function trimmedTo(hunk: Hunk, nextLines: readonly string[], added: ReadonlySet<string>): Hunk {
    const wrote = (index: number): boolean => added.has(hashLine(nextLines[index]!));
    let { start, end } = hunk;
    if (!nextLines.slice(start, end).some((_, offset) => wrote(start + offset))) {
        return hunk;
    }
    while (!wrote(start)) {
        start++;
    }
    while (!wrote(end - 1)) {
        end--;
    }
    return start === hunk.start && end === hunk.end ? hunk : { ...hunk, start, end, trimmed: true };
}

/*
 * Where a write is when the text it replaced is not known: a whole-file write is the whole file, an
 * edit is the first place its added lines stand, in order. A removal alone leaves no place to find.
 */
export function locatedHunks(next: readonly string[], signature: WriteSignature): Hunk[] {
    if (signature.all) {
        return next.length === 0 ? [] : [{ start: 0, end: next.length, baseStart: 0, baseEnd: 0 }];
    }
    const hunks: Hunk[] = [];
    for (const block of signature.blocks) {
        if (block.added.length === 0) {
            continue;
        }
        const wanted = block.added.map(hashLine);
        const at = next.findIndex((_, index) => wanted.every((hash, offset) => next[index + offset] === hash));
        if (at >= 0) {
            hunks.push({ start: at, end: at + wanted.length, baseStart: 0, baseEnd: 0 });
        }
    }
    return hunks;
}

/* The lines of `start..end` (zero-based, exclusive) that no run covers, as ranges. */
export function uncoveredRanges(start: number, end: number, runs: readonly ProvenanceRun[]): Array<[number, number]> {
    const covered = new Set<number>();
    for (const run of runs) {
        for (let line = Math.max(run.start - 1, start); line < Math.min(run.end, end); line++) {
            covered.add(line);
        }
    }
    const open: number[] = [];
    for (let line = start; line < end; line++) {
        if (!covered.has(line)) {
            open.push(line);
        }
    }
    return groupsOf(open).map(([first, last]) => [first, last + 1]);
}

/* What a run keeps of the lines it replaced; more than the bounds is left out, since half of it would put back a broken file. */
export function boundedBefore(lines: readonly string[]): string[] | undefined {
    if (lines.length === 0 || lines.length > PROVENANCE_LIMITS.beforeLines) {
        return undefined;
    }
    const bytes = lines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0);
    return bytes > PROVENANCE_LIMITS.beforeBytes ? undefined : [...lines];
}
