import type { EditSource } from './edit-source.ts';
import { mapOffset } from './offsets.ts';
import { indentationColumn } from './structure.ts';
import type { Selection, TextEdit } from './types.ts';

export interface PasteOptions {
    tabSize: number;
    insertSpaces: boolean;
    /* The text was copied from a caret with nothing selected: a caret with nothing selected takes it as lines above its own. */
    wholeLines: boolean;
    /* Moves a pasted block to the indentation of the place it lands on. */
    reindent: boolean;
}

export interface PastePlan {
    edits: TextEdit[];
    selections: Selection[];
}

function whitespaceOf(text: string): string {
    return /^[\t ]*/.exec(text)![0];
}

function isBlank(text: string): boolean {
    return text.trim() === '';
}

/* A line break at the end is the end of the last line, not a line of its own. */
function linesOf(text: string): string[] {
    return text.replace(/\r?\n$/, '').split(/\r?\n/);
}

/* One line of the text for each caret, when there are as many lines as carets. */
function perCaretLines(text: string, carets: number): string[] | null {
    if (carets < 2) {
        return null;
    }
    const lines = linesOf(text);
    return lines.length === carets ? lines : null;
}

function indentText(width: number, options: PasteOptions): string {
    if (options.insertSpaces) {
        return ' '.repeat(width);
    }
    return '\t'.repeat(Math.floor(width / options.tabSize)) + ' '.repeat(width % options.tabSize);
}

/*
 * Where a block of several lines lands, it lands at the indentation of the line it is pasted into:
 * the pasted lines move together by the difference between that indentation and the least indented
 * of them. A first line that starts at the caret stays where it is, and the lines below it are
 * measured against each other, since its own indentation was left behind in the copy.
 */
function reindent(source: EditSource, from: number, text: string, options: PasteOptions): string {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) {
        return text;
    }
    const line = source.line(source.lineAt(from));
    const before = source.slice(line.start, from);
    const caretColumn = indentationColumn(before, options.tabSize);
    const lineIndent = indentationColumn(whitespaceOf(line.text), options.tabSize);
    const startsLine = isBlank(before);
    const firstIndent = whitespaceOf(lines[0]!);
    const anchored = startsLine ? caretColumn > 0 && firstIndent === '' : true;
    const target = startsLine ? (anchored ? caretColumn : Math.max(caretColumn, lineIndent)) : lineIndent;
    const widths = lines.map((entry) => (isBlank(entry) ? null : indentationColumn(whitespaceOf(entry), options.tabSize)));
    const measured = widths.filter((width, index): width is number => width !== null && !(anchored && index === 0));
    const trailingBreak = isBlank(lines.at(-1)!);
    if (measured.length > 0) {
        const delta = target - Math.min(...measured);
        for (const [index, entry] of lines.entries()) {
            const width = widths[index];
            if (width === null || width === undefined || (anchored && index === 0)) {
                continue;
            }
            // The first line follows the indentation already in front of the caret.
            const indent = Math.max(0, width + delta - (index === 0 ? caretColumn : 0));
            if (indent !== width) {
                lines[index] = indentText(indent, options) + entry.slice(whitespaceOf(entry).length);
            }
        }
    }
    if (trailingBreak) {
        // What follows the paste stays under the indentation of the line it was on.
        lines[lines.length - 1] = whitespaceOf(before);
    }
    return lines.join(newline);
}

/*
 * What pasting `text` does at every selection: one line for each caret when the counts match, text
 * copied from a bare caret as lines above the caret's own, and a block moved to the indentation of
 * the line it lands on.
 */
export function planPaste(source: EditSource, selections: readonly Selection[], text: string, options: PasteOptions): PastePlan {
    const ordered = selections.map((selection, index) => ({
        from: Math.min(selection.anchor, selection.head),
        to: Math.max(selection.anchor, selection.head),
        index
    }));
    ordered.sort((left, right) => left.from - right.from);
    const segments = perCaretLines(text, selections.length);
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const edits: TextEdit[] = [];
    if (options.wholeLines && selections.every((selection) => selection.anchor === selection.head)) {
        const lineEdits = new Map<number, string>();
        for (const [position, { from }] of ordered.entries()) {
            const start = source.line(source.lineAt(from)).start;
            const piece = segments?.[position] ?? text;
            lineEdits.set(start, (lineEdits.get(start) ?? '') + (/\r?\n$/.test(piece) ? piece : piece + newline));
        }
        for (const [start, insert] of lineEdits) {
            edits.push({ from: start, to: start, text: insert });
        }
        return { edits, selections: selections.map((selection) => ({ anchor: mapOffset(selection.anchor, edits), head: mapOffset(selection.head, edits) })) };
    }
    const carets: Selection[] = new Array<Selection>(selections.length);
    let shift = 0;
    for (const [position, { from, to, index }] of ordered.entries()) {
        const piece = segments?.[position] ?? text;
        const inserted = options.reindent && segments === null ? reindent(source, from, piece, options) : piece;
        edits.push({ from, to, text: inserted });
        const head = from + shift + inserted.length;
        carets[index] = { anchor: head, head };
        shift += inserted.length - (to - from);
    }
    return { edits, selections: carets };
}
