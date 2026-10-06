import type { EditorContentChange, EditorMarker, EditorMarkerSeverity, EditorPosition, EditorRange } from '@adecore/editor';
import type { Diagnostic } from '@adecore/lsp';

/* A diagnostic and the language server process that reported it. */
export interface Problem {
    readonly diagnostic: Diagnostic;
    readonly server: string;
}

const SEVERITIES: Record<number, EditorMarkerSeverity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };
const UNNECESSARY = 1;
const DEPRECATED = 2;
/* The scroll track's tip is a line or two, so a long message is cut where it stops being a tip. */
const TICK_MESSAGE_LENGTH = 300;

/* A report that names no severity is an error, which is the safer side to be wrong on. */
export function severityOf(diagnostic: Diagnostic): EditorMarkerSeverity {
    return SEVERITIES[diagnostic.severity ?? 1] ?? 'error';
}

export function markerOf(diagnostic: Diagnostic): EditorMarker {
    return {
        range: diagnostic.range,
        severity: severityOf(diagnostic),
        unnecessary: diagnostic.tags?.includes(UNNECESSARY) === true,
        deprecated: diagnostic.tags?.includes(DEPRECATED) === true,
        message: diagnostic.message.length > TICK_MESSAGE_LENGTH ? `${diagnostic.message.slice(0, TICK_MESSAGE_LENGTH)}…` : diagnostic.message
    };
}

export function comparePositions(left: EditorPosition, right: EditorPosition): number {
    return left.line === right.line ? left.character - right.character : left.line - right.line;
}

/* Where an insertion of `text` at `start` ends, counting a line break of any kind once. */
function endOfInsertion(start: EditorPosition, text: string): EditorPosition {
    const lines = text.split(/\r\n|\r|\n/);
    return lines.length === 1
        ? { line: start.line, character: start.character + text.length }
        : { line: start.line + lines.length - 1, character: lines[lines.length - 1]!.length };
}

/* Where a position is once one change is applied to the text it was in. One inside the replaced range lands after the new text. */
export function shiftPosition(position: EditorPosition, change: EditorContentChange): EditorPosition {
    const { start, end } = change.range;
    if (comparePositions(position, start) < 0) {
        return position;
    }
    const inserted = endOfInsertion(start, change.text);
    if (comparePositions(position, end) < 0) {
        return inserted;
    }
    return position.line === end.line
        ? { line: inserted.line, character: inserted.character + (position.character - end.character) }
        : { line: position.line + (inserted.line - end.line), character: position.character };
}

export function shiftRange(range: EditorRange, changes: readonly EditorContentChange[]): EditorRange {
    let start = range.start;
    let end = range.end;
    for (const change of changes) {
        start = shiftPosition(start, change);
        end = shiftPosition(end, change);
    }
    return { start, end };
}

/* A range holds a position from its start up to and including its end, so a caret at either edge of a word is on it. An empty range holds only its own place. */
export function rangeHolds(range: EditorRange, position: EditorPosition): boolean {
    return comparePositions(range.start, position) <= 0 && comparePositions(position, range.end) <= 0;
}

/* The problems under a position, worst first. A hint is not a problem, so it is left to the colors and the faded text. */
export function problemsAt(problems: readonly Problem[], position: EditorPosition): Problem[] {
    const rank = (problem: Problem): number => problem.diagnostic.severity ?? 1;
    return problems
        .filter((problem) => (problem.diagnostic.severity ?? 1) < 4 && rangeHolds(problem.diagnostic.range, position))
        .sort((left, right) => rank(left) - rank(right));
}

/* The start of the first problem after the position, or the last one before it when `direction` is back; it wraps round the document. */
export function neighborProblem(problems: readonly Problem[], from: EditorPosition, direction: 1 | -1): Problem | null {
    const candidates = problems
        .filter((problem) => (problem.diagnostic.severity ?? 1) < 4)
        .sort((left, right) => comparePositions(left.diagnostic.range.start, right.diagnostic.range.start));
    if (candidates.length === 0) {
        return null;
    }
    if (direction === 1) {
        return candidates.find((problem) => comparePositions(problem.diagnostic.range.start, from) > 0) ?? candidates[0]!;
    }
    return [...candidates].reverse().find((problem) => comparePositions(problem.diagnostic.range.start, from) < 0) ?? candidates[candidates.length - 1]!;
}

/* `ts(2551)`, or the code alone, or the source alone, whichever the server gave. */
export function codeLabelOf(diagnostic: Diagnostic): string {
    const code = diagnostic.code === undefined ? '' : String(diagnostic.code);
    if (diagnostic.source !== undefined && code !== '') {
        return `${diagnostic.source}(${code})`;
    }
    return code !== '' ? code : (diagnostic.source ?? '');
}
