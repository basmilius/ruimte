export interface TextSpan {
    /* UTF-16 offsets into the text before the change. */
    readonly start: number;
    readonly end: number;
    /* What stands between them after it. */
    readonly text: string;
}

function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}

/*
 * The one stretch that differs between two texts, found from both ends. Replacing only that keeps a
 * cursor, a selection and the scroll where they were anywhere outside it, which setting the whole
 * text would not. Null when the two are the same.
 */
export function changedSpan(before: string, after: string): TextSpan | null {
    if (before === after) {
        return null;
    }
    const limit = Math.min(before.length, after.length);
    let start = 0;
    while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) {
        start += 1;
    }
    // Never between the halves of a surrogate pair, which would leave a lone half on either side.
    if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) {
        start -= 1;
    }
    let tail = 0;
    while (tail < limit - start && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) {
        tail += 1;
    }
    if (tail > 0 && isLowSurrogate(before.charCodeAt(before.length - tail))) {
        tail -= 1;
    }
    return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
}

/* A line diff stops at this much work (snake steps and diagonals visited) and falls back to the one span. */
const DIFF_WORK_LIMIT = 4_000_000;
/* More edit lines than this is a rewrite, where one span is as good as any. */
const DIFF_EDIT_LIMIT = 1_000;
/* Past this much text between the first and last change the intern table costs more than the diff is worth. */
const DIFF_TEXT_LIMIT = 16 * 1024 * 1024;

interface LineHunk {
    readonly beforeFrom: number;
    readonly beforeTo: number;
    readonly afterFrom: number;
    readonly afterTo: number;
}

function splitLines(text: string): string[] {
    const lines: string[] = [];
    let from = 0;
    for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', from)) {
        lines.push(text.slice(from, at + 1));
        from = at + 1;
    }
    if (from < text.length) {
        lines.push(text.slice(from));
    }
    return lines;
}

/*
 * The shortest edit script between two line sequences (Myers), as the runs of lines that differ.
 * Null once the work or the number of edited lines passes its limit.
 */
function diffLineHunks(before: Int32Array, after: Int32Array): LineHunk[] | null {
    const rows = before.length;
    const columns = after.length;
    const maxEdits = Math.min(rows + columns, DIFF_EDIT_LIMIT);
    const base = maxEdits + 1;
    const frontier = new Int32Array(2 * base + 2);
    const trace: Int32Array[] = [];
    let work = 0;
    let found = -1;
    for (let edits = 0; edits <= maxEdits && found < 0; edits++) {
        trace.push(frontier.slice());
        for (let diagonal = -edits; diagonal <= edits; diagonal += 2) {
            let x: number;
            if (diagonal === -edits || (diagonal !== edits && frontier[base + diagonal - 1]! < frontier[base + diagonal + 1]!)) {
                x = frontier[base + diagonal + 1]!;
            } else {
                x = frontier[base + diagonal - 1]! + 1;
            }
            let y = x - diagonal;
            while (x < rows && y < columns && before[x] === after[y]) {
                x++;
                y++;
                work++;
            }
            work++;
            frontier[base + diagonal] = x;
            if (x >= rows && y >= columns) {
                found = edits;
                break;
            }
        }
        if (work > DIFF_WORK_LIMIT) {
            return null;
        }
    }
    if (found < 0) {
        return null;
    }
    const operations: { kind: 'delete' | 'insert'; x: number; y: number }[] = [];
    let x = rows;
    let y = columns;
    for (let edits = found; edits > 0; edits--) {
        const previous = trace[edits]!;
        const diagonal = x - y;
        const fromAbove = diagonal === -edits || (diagonal !== edits && previous[base + diagonal - 1]! < previous[base + diagonal + 1]!);
        const previousDiagonal = fromAbove ? diagonal + 1 : diagonal - 1;
        const previousX = previous[base + previousDiagonal]!;
        const previousY = previousX - previousDiagonal;
        while (x > previousX && y > previousY) {
            x--;
            y--;
        }
        if (fromAbove) {
            y--;
            operations.push({ kind: 'insert', x, y });
        } else {
            x--;
            operations.push({ kind: 'delete', x, y });
        }
    }
    operations.reverse();
    const hunks: LineHunk[] = [];
    let open: { beforeFrom: number; afterFrom: number; beforeTo: number; afterTo: number } | null = null;
    for (const operation of operations) {
        if (open !== null && open.beforeTo === operation.x && open.afterTo === operation.y) {
            if (operation.kind === 'delete') {
                open.beforeTo++;
            } else {
                open.afterTo++;
            }
            continue;
        }
        if (open !== null) {
            hunks.push(open);
        }
        open = {
            beforeFrom: operation.x,
            afterFrom: operation.y,
            beforeTo: operation.x + (operation.kind === 'delete' ? 1 : 0),
            afterTo: operation.y + (operation.kind === 'insert' ? 1 : 0)
        };
    }
    if (open !== null) {
        hunks.push(open);
    }
    return hunks;
}

/*
 * The stretches that differ between two texts, found by a line diff with a bounded cost, in the
 * coordinates of `before`. Applied as one batch they keep every cursor, fold, marker and the scroll
 * wherever the text around them stayed, also between two far apart changes, where the one span of
 * `changedSpan` would cover everything in between. A rewrite that passes the bounds is that one span.
 */
export function changedSpans(before: string, after: string): TextSpan[] {
    const outer = changedSpan(before, after);
    if (outer === null) {
        return [];
    }
    const afterEnd = after.length - (before.length - outer.end);
    if (outer.end - outer.start + (afterEnd - outer.start) > DIFF_TEXT_LIMIT) {
        return [outer];
    }
    // Whole lines on both sides of the change, so the diff compares lines and not their halves.
    const lineStart = outer.start === 0 ? 0 : before.lastIndexOf('\n', outer.start - 1) + 1;
    const lineEnd = (at: string, from: number): number => {
        const newline = at.indexOf('\n', from);
        return newline < 0 ? at.length : newline + 1;
    };
    const beforeEnd = lineEnd(before, outer.end > outer.start ? outer.end - 1 : outer.end);
    const afterLineEnd = beforeEnd - outer.end + afterEnd;
    const beforeLines = splitLines(before.slice(lineStart, beforeEnd));
    const afterLines = splitLines(after.slice(lineStart, afterLineEnd));
    if (beforeLines.length < 2 && afterLines.length < 2) {
        return [outer];
    }
    const ids = new Map<string, number>();
    const intern = (lines: string[]): Int32Array => {
        const result = new Int32Array(lines.length);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            let id = ids.get(line);
            if (id === undefined) {
                id = ids.size;
                ids.set(line, id);
            }
            result[i] = id;
        }
        return result;
    };
    const hunks = diffLineHunks(intern(beforeLines), intern(afterLines));
    if (hunks === null || hunks.length === 0) {
        return [outer];
    }
    const beforeOffsets = lineOffsets(beforeLines, lineStart);
    const afterOffsets = lineOffsets(afterLines, lineStart);
    const spans: TextSpan[] = [];
    for (const hunk of hunks) {
        const beforeFrom = beforeOffsets[hunk.beforeFrom]!;
        const afterFrom = afterOffsets[hunk.afterFrom]!;
        const inner = changedSpan(before.slice(beforeFrom, beforeOffsets[hunk.beforeTo]), after.slice(afterFrom, afterOffsets[hunk.afterTo]));
        if (inner !== null) {
            spans.push({ start: beforeFrom + inner.start, end: beforeFrom + inner.end, text: inner.text });
        }
    }
    return spans;
}

function lineOffsets(lines: readonly string[], base: number): number[] {
    const offsets = [base];
    for (const line of lines) {
        offsets.push(offsets[offsets.length - 1]! + line.length);
    }
    return offsets;
}
