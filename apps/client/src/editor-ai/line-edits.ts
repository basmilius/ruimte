import { shapeOf, splitLines } from '@ruimte/merge';
import type { EditorContentChange } from '@ruimte/smart-editor';

/* A replacement of whole lines, zero-based with `to` exclusive, such as a block a review puts back. */
export interface LineReplacement {
    readonly from: number;
    readonly to: number;
    readonly lines: readonly string[];
}

/*
 * The edit that makes the lines `from` up to `to` of `text` into `lines`. A file that does not end on a
 * newline has no line break after its last line, so the break before it goes along when the last lines
 * leave and comes with the new ones when they are put at the end.
 */
export function replaceLines(text: string, replacement: LineReplacement): EditorContentChange {
    const { from, to, lines } = replacement;
    const eol = shapeOf(text).eol;
    const raw = text.split('\n');
    const count = splitLines(text).length;
    const body = lines.join(eol);
    if (to < count || text === '' || text.endsWith('\n')) {
        return { range: { start: { line: from, character: 0 }, end: { line: to, character: 0 } }, text: lines.length === 0 ? '' : `${body}${eol}` };
    }
    const end = { line: count - 1, character: raw[count - 1]!.length };
    if (from === count) {
        return { range: { start: end, end }, text: lines.length === 0 ? '' : `${eol}${body}` };
    }
    if (lines.length === 0 && from > 0) {
        return { range: { start: { line: from - 1, character: raw[from - 1]!.length }, end }, text: '' };
    }
    return { range: { start: { line: from, character: 0 }, end }, text: body };
}

/* Several replacements of one text as the edits an editor applies at once; replacements that touch are one edit. */
export function replaceAllLines(text: string, replacements: readonly LineReplacement[]): EditorContentChange[] {
    const ordered = [...replacements].sort((left, right) => left.from - right.from);
    const merged: LineReplacement[] = [];
    for (const next of ordered) {
        const last = merged.at(-1);
        if (last !== undefined && last.to >= next.from) {
            merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, next.to), lines: [...last.lines, ...next.lines] };
        } else {
            merged.push(next);
        }
    }
    return merged.map((replacement) => replaceLines(text, replacement));
}
