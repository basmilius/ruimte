import type { EditPlan, EditSource } from './edit-source.ts';
import { type BlockComment, type CommentSyntax, commentSyntax } from './languages.ts';
import { mapOffset } from './offsets.ts';
import { indentationColumn } from './structure.ts';
import type { Selection, TextEdit } from './types.ts';

export interface CommentOptions {
    language: string;
    tabSize: number;
    insertSpaces: boolean;
    /* Replaces the language's own line marker. */
    lineToken?: string;
    /* The lines that stand on one row of the screen, so a collapsed fold is commented as a whole. */
    lineSpan?: (line: number) => { first: number; last: number };
}

interface Block {
    first: number;
    last: number;
    /* Indices into the selections. */
    carets: number[];
}

interface Geometry {
    start: number;
    length: number;
}

function whitespaceOf(text: string): string {
    return /^[\t ]*/.exec(text)![0];
}

function isBlank(text: string): boolean {
    return text.trim() === '';
}

function syntaxOf(source: EditSource, options: CommentOptions, line: number): CommentSyntax {
    const syntax = commentSyntax(options.language, source.region(line));
    return options.lineToken === undefined ? syntax : { ...syntax, line: options.lineToken };
}

function rangeOf(selection: Selection): { from: number; to: number } {
    return { from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head) };
}

/* The runs of adjacent lines the selections touch. A selection that ends at the start of a line does not touch it. */
function blocksOf(source: EditSource, selections: readonly Selection[], span?: CommentOptions['lineSpan']): Block[] {
    const blocks: Block[] = [];
    const ordered = selections.map((selection, index) => ({ ...rangeOf(selection), index })).sort((left, right) => left.from - right.from);
    for (const { from, to, index } of ordered) {
        let first = source.lineAt(from);
        let last = source.lineAt(to);
        if (last > first && source.line(last).start === to) {
            last--;
        }
        if (span) {
            first = span(first).first;
            last = Math.max(last, span(last).last);
        }
        const previous = blocks.at(-1);
        if (previous && first <= previous.last + 1) {
            previous.last = Math.max(previous.last, last);
            previous.carets.push(index);
        } else {
            blocks.push({ first, last, carets: [index] });
        }
    }
    return blocks;
}

function isCommented(text: string, syntax: CommentSyntax, multiline: boolean): boolean {
    const trimmed = text.trim();
    if (syntax.line !== null) {
        return trimmed.startsWith(syntax.line.trimEnd());
    }
    const block = syntax.block!;
    if (trimmed === '') {
        return multiline;
    }
    return trimmed.length >= block.open.length + block.close.length && trimmed.startsWith(block.open) && trimmed.endsWith(block.close);
}

function indentText(width: number, options: CommentOptions): string {
    if (options.insertSpaces) {
        return ' '.repeat(width);
    }
    return '\t'.repeat(Math.floor(width / options.tabSize)) + ' '.repeat(width % options.tabSize);
}

/* The new place of a line after the edits, which never cross a line break. */
function geometryOf(source: EditSource, edits: readonly TextEdit[], index: number): Geometry {
    const bounds = source.line(index);
    const result = { start: bounds.start, length: bounds.end - bounds.start };
    for (const edit of edits) {
        const delta = edit.text.length - (edit.to - edit.from);
        if (edit.from < bounds.start) {
            result.start += delta;
        } else if (edit.to <= bounds.end) {
            result.length += delta;
        }
    }
    return result;
}

/*
 * Comments the lines the selections touch, or takes the comment off when every non-blank one has it.
 * The markers go in at the smallest indentation of the lines, and a lone caret moves to the next line.
 */
export function planLineComments(source: EditSource, selections: readonly Selection[], options: CommentOptions): EditPlan | null {
    const blocks = blocksOf(source, selections, options.lineSpan);
    const syntaxes = blocks.map((block) => syntaxOf(source, options, block.first));
    if (syntaxes.some((syntax) => syntax.line === null && syntax.block === null)) {
        return null;
    }
    const lineBased = syntaxes.map((syntax): CommentSyntax => (syntax.line === null ? syntax : { ...syntax, block: null }));
    let allCommented = true;
    let anyCommented = false;
    for (const [position, block] of blocks.entries()) {
        const single = block.first === block.last;
        for (let line = block.first; line <= block.last; line++) {
            const text = source.line(line).text;
            const commented = isCommented(text, lineBased[position]!, !single);
            if (commented && !isBlank(text)) {
                anyCommented = true;
            }
            if (!commented && (single || !isBlank(text))) {
                allCommented = false;
            }
        }
        if (allCommented && !single && !anyCommented) {
            allCommented = false;
        }
    }

    const edits: TextEdit[] = [];
    const placed = new Set<number>();
    for (const [position, block] of blocks.entries()) {
        const syntax = lineBased[position]!;
        const multiline = block.first !== block.last;
        const startingNewLine =
            !multiline &&
            block.carets.length === 1 &&
            isBlank(source.line(block.first).text) &&
            selections[block.carets[0]!]!.anchor === selections[block.carets[0]!]!.head;
        const minimum = allCommented ? 0 : minimumIndent(source, block, syntax, options);
        for (let line = block.first; line <= block.last; line++) {
            const bounds = source.line(line);
            const edit = allCommented
                ? uncommentLine(bounds.start, bounds.text, syntax)
                : commentLine(bounds.start, bounds.text, syntax, minimum, multiline, startingNewLine, options);
            if (edit) {
                edits.push(edit);
                if (startingNewLine && !allCommented) {
                    placed.add(line);
                }
            }
        }
    }
    if (edits.length === 0) {
        return null;
    }
    return { edits, selections: finalSelections(source, selections, blocks, edits, allCommented, placed, lineBased, options.lineSpan) };
}

function minimumIndent(source: EditSource, block: Block, syntax: CommentSyntax, options: CommentOptions): number {
    let minimum = Number.POSITIVE_INFINITY;
    for (let line = block.first; line <= block.last; line++) {
        const text = source.line(line).text;
        if (!isBlank(text)) {
            minimum = Math.min(minimum, indentationColumn(whitespaceOf(text), options.tabSize));
        }
    }
    if (block.first > 0) {
        const previous = source.line(block.first - 1).text;
        const marker = syntax.line ?? syntax.block?.open;
        if (marker && previous.trimStart().startsWith(marker)) {
            minimum = Math.min(minimum, indentationColumn(whitespaceOf(previous), options.tabSize));
        }
    }
    return Number.isFinite(minimum) ? minimum : 0;
}

function commentLine(
    start: number,
    text: string,
    syntax: CommentSyntax,
    minimum: number,
    multiline: boolean,
    startingNewLine: boolean,
    options: CommentOptions
): TextEdit | null {
    const blank = isBlank(text);
    if (syntax.line === null && blank && multiline) {
        return null;
    }
    const leading = whitespaceOf(text);
    let kept = 0;
    let width = 0;
    while (kept < leading.length && width < minimum) {
        width += leading[kept] === '\t' ? options.tabSize - (width % options.tabSize) : 1;
        kept++;
    }
    // A line whose whitespace ends before the indent does is padded out to it.
    const short = width < minimum;
    const padding = short ? indentText(minimum, options) : '';
    const markerAt = start + (short ? leading.length : kept);
    if (syntax.line !== null) {
        const space = !blank || startingNewLine ? ' ' : '';
        return { from: short ? start : markerAt, to: markerAt, text: padding + syntax.line + space };
    }
    const { open, close } = syntax.block!;
    const end = start + text.trimEnd().length;
    const body = blank ? '' : text.slice(markerAt - start, end - start);
    return { from: short ? start : markerAt, to: blank ? start + text.length : end, text: padding + open + (blank ? '  ' : ` ${body} `) + close };
}

function uncommentLine(start: number, text: string, syntax: CommentSyntax): TextEdit | null {
    const trimmed = text.trim();
    if (trimmed === '') {
        return null;
    }
    const leading = whitespaceOf(text);
    let rest: string;
    if (syntax.line !== null) {
        const marker = syntax.line.trimEnd();
        if (!trimmed.startsWith(marker)) {
            return null;
        }
        const body = text.slice(leading.length + marker.length);
        rest = body.startsWith(' ') ? body.slice(1) : body;
    } else {
        const { open, close } = syntax.block!;
        if (!trimmed.startsWith(open) || !trimmed.endsWith(close)) {
            return null;
        }
        const inner = text.trimEnd().slice(leading.length + open.length, -close.length);
        rest = (inner.startsWith(' ') ? inner.slice(1) : inner).replace(/ $/, '');
        rest += text.slice(text.trimEnd().length);
    }
    const kept = leading + rest;
    if (kept.trim() === '') {
        return { from: start, to: start + text.length, text: '' };
    }
    return { from: start + leading.length, to: start + text.length, text: rest };
}

function finalSelections(
    source: EditSource,
    selections: readonly Selection[],
    blocks: readonly Block[],
    edits: readonly TextEdit[],
    allCommented: boolean,
    placed: ReadonlySet<number>,
    syntaxes: readonly CommentSyntax[],
    span: CommentOptions['lineSpan']
): Selection[] {
    const sorted = [...edits].sort((left, right) => left.from - right.from);
    const result = selections.map((selection) => ({
        anchor: mapOffset(selection.anchor, sorted, true),
        head: mapOffset(selection.head, sorted, true)
    }));
    const moveCarets = blocks.every((block) => block.carets.length === 1 || block.first === block.last);
    if (!moveCarets) {
        return result;
    }
    for (const [position, block] of blocks.entries()) {
        for (const index of block.carets) {
            const selection = selections[index]!;
            const { from, to } = rangeOf(selection);
            const line = source.lineAt(from);
            if (from === to) {
                result[index] = caretAfter(source, sorted, line, span?.(line).last ?? line, selection.head, allCommented, placed, syntaxes[position]!);
                continue;
            }
            const lastLine = source.lineAt(to - 1);
            const whole = source.line(line).start === from && source.line(lastLine).next === to;
            if (whole) {
                const start = geometryOf(source, sorted, line).start;
                result[index] =
                    selection.anchor <= selection.head ? { anchor: start, head: result[index]!.head } : { anchor: result[index]!.anchor, head: start };
            }
        }
    }
    return result;
}

function caretAfter(
    source: EditSource,
    edits: readonly TextEdit[],
    line: number,
    lastLine: number,
    offset: number,
    allCommented: boolean,
    placed: ReadonlySet<number>,
    syntax: CommentSyntax
): Selection {
    const geometry = geometryOf(source, edits, line);
    if (placed.has(line) && !allCommented) {
        const caret = syntax.line === null ? geometry.start + geometry.length - syntax.block!.close.length - 1 : geometry.start + geometry.length;
        return { anchor: caret, head: caret };
    }
    const mapped = mapOffset(offset, edits);
    if (lastLine >= source.lineCount - 1) {
        return { anchor: mapped, head: mapped };
    }
    const next = geometryOf(source, edits, lastLine + 1);
    const column = Math.min(mapped - geometry.start, next.length);
    return { anchor: next.start + column, head: next.start + column };
}

/* Where the comment that holds `offset` runs, for the markers the lexer knows. Null outside a comment. */
function commentAround(source: EditSource, offset: number, block: BlockComment): { from: number; to: number } | null {
    const context = source.context(offset);
    if ((context.mode !== 'block-comment' && context.mode !== 'html-comment') || context.commentStart === undefined) {
        return null;
    }
    const from = context.commentStart;
    if (source.slice(from, from + block.open.length) !== block.open) {
        return null;
    }
    const close = source.slice(from + block.open.length, from + block.open.length + 200_000).indexOf(block.close);
    return close < 0 ? null : { from, to: from + block.open.length + close + block.close.length };
}

/* The comment a selection is, markers and all, or null. */
function commentOf(source: EditSource, from: number, to: number, block: BlockComment): { from: number; to: number } | null {
    const text = source.slice(from, to);
    const start = text.length - text.trimStart().length;
    const end = text.trimEnd().length;
    const body = text.slice(start, end);
    if (body.length >= block.open.length + block.close.length && body.startsWith(block.open) && body.endsWith(block.close)) {
        return { from: from + start, to: from + end };
    }
    return null;
}

/*
 * Wraps each selection in the block markers, or takes them off a comment the selection is or sits in.
 * With nothing selected it opens an empty comment around the caret.
 */
export function planBlockComment(source: EditSource, selections: readonly Selection[], options: CommentOptions): EditPlan | null {
    const edits: TextEdit[] = [];
    const result: Selection[] = [];
    let offsetDelta = 0;
    for (const selection of selections) {
        const { from, to } = rangeOf(selection);
        const block = syntaxOf(source, options, source.lineAt(from)).block;
        if (!block) {
            return null;
        }
        const found = commentOf(source, from, to, block) ?? commentAround(source, from, block);
        if (found && from !== to && !(found.from >= from && found.to <= to)) {
            return null;
        }
        if (found) {
            const innerStart = found.from + block.open.length + (source.charAt(found.from + block.open.length) === ' ' ? 1 : 0);
            const closeAt = found.to - block.close.length;
            const innerEnd = closeAt - (source.charAt(closeAt - 1) === ' ' && closeAt - 1 >= innerStart ? 1 : 0);
            edits.push({ from: found.from, to: innerStart, text: '' }, { from: innerEnd, to: found.to, text: '' });
            const head = Math.min(Math.max(selection.head, innerStart), innerEnd);
            const anchor = Math.min(Math.max(selection.anchor, innerStart), innerEnd);
            const removedBefore = innerStart - found.from;
            result.push({ anchor: anchor - removedBefore + offsetDelta, head: head - removedBefore + offsetDelta });
            offsetDelta -= innerStart - found.from + (found.to - innerEnd);
            continue;
        }
        if (source.slice(from, to).includes(block.close)) {
            return null;
        }
        if (from === to) {
            const text = `${block.open}  ${block.close}`;
            edits.push({ from, to, text });
            const caret = from + offsetDelta + block.open.length + 1;
            result.push({ anchor: caret, head: caret });
            offsetDelta += text.length;
            continue;
        }
        const wrapped = wrapRange(source, from, to, block, options);
        edits.push(...wrapped);
        const added = wrapped.reduce((sum, edit) => sum + edit.text.length, 0);
        result.push({ anchor: from + offsetDelta, head: to + added + offsetDelta });
        offsetDelta += added;
    }
    return { edits, selections: result };
}

function wrapRange(source: EditSource, from: number, to: number, block: BlockComment, options: CommentOptions): TextEdit[] {
    const first = source.lineAt(from);
    const last = source.lineAt(to - 1);
    const endsLine = source.charAt(to - 1) === '\n' || to === source.line(source.lineCount - 1).end;
    if (from !== source.line(first).start || !endsLine) {
        return [
            { from, to: from, text: `${block.open} ` },
            { from: to, to, text: ` ${block.close}` }
        ];
    }
    let minimum = Number.POSITIVE_INFINITY;
    for (let line = first; line <= last; line++) {
        const text = source.line(line).text;
        if (!isBlank(text)) {
            minimum = Math.min(minimum, indentationColumn(whitespaceOf(text), options.tabSize));
        }
    }
    const space = indentText(Number.isFinite(minimum) ? minimum : 0, options);
    const newline = source.newline(first);
    const closing = source.charAt(to - 1) === '\n' ? `${space}${block.close}${newline}` : `${newline}${space}${block.close}`;
    return [
        { from, to: from, text: `${space}${block.open}${newline}` },
        { from: to, to, text: closing }
    ];
}
