import type { EditPlan, EditSource } from './edit-source.ts';
import { commentSyntax } from './languages.ts';
import { continues } from './enter.ts';
import { indentsByBrackets } from './lexical.ts';
import { markupGuard } from './markup-regions.ts';
import { mapOffset } from './offsets.ts';
import type { Selection, TextEdit } from './types.ts';
import type { TypingContext } from './typing-context.ts';

export interface LineCommandOptions {
    language: string;
    /* One level of indentation. */
    unit: string;
}

const identifier = /[\p{L}\p{N}\p{M}\p{Pc}$]/u;

function rangeOf(selection: Selection): { from: number; to: number } {
    return { from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head) };
}

function whitespaceOf(text: string): string {
    return /^[\t ]*/.exec(text)![0];
}

function isBlank(text: string): boolean {
    return text.trim() === '';
}

/* How far the edits in front of an offset moved it. An edit that starts at the offset is not in front of it. */
function shiftBefore(offset: number, edits: readonly TextEdit[]): number {
    return edits.filter((edit) => edit.from < offset).reduce((sum, edit) => sum + edit.text.length - (Math.min(edit.to, offset) - edit.from), 0);
}

/* The offset of the first character after `from` that is not whitespace, line breaks included. */
function skipWhitespace(source: EditSource, from: number): number {
    const last = source.line(source.lineCount - 1).end;
    let offset = from;
    while (offset < last && /\s/.test(source.charAt(offset))) {
        offset++;
    }
    return offset;
}

/* What goes where two lines meet: nothing before a closer, a comma or a dot and after an opener, else a space. */
function spacingBetween(previous: string, next: string): string {
    if (next === '' || /^[)\],;]/.test(next) || /^\.(?![.\d])/.test(next) || /[([]$/.test(previous)) {
        return '';
    }
    return ' ';
}

interface Join {
    from: number;
    to: number;
    text: string;
    /* Where the caret goes in the text, which is where the lines were split. */
    caret: number;
}

/* The comment a line ends in, as its start and the marker it opens with. */
function endComment(source: EditSource, options: LineCommandOptions, line: number): { start: number; marker: string } | null {
    const bounds = source.line(line);
    const syntax = commentSyntax(options.language, source.region(line));
    const context = source.context(bounds.end);
    if (context.mode !== 'line-comment' || context.commentStart === undefined || context.commentStart < bounds.start || syntax.line === null) {
        return null;
    }
    return { start: context.commentStart, marker: syntax.line };
}

/* One join of a line with the next content after it. */
function joinAfter(source: EditSource, options: LineCommandOptions, index: number): Join | null {
    const left = source.line(index);
    const next = skipWhitespace(source, left.end);
    const trimmedEnd = left.start + left.text.trimEnd().length;
    const nextLine = source.line(source.lineAt(next));
    const content = source.slice(next, nextLine.end).trimEnd();
    if (isBlank(left.text)) {
        return { from: left.start, to: nextLine.start, text: '', caret: whitespaceOf(nextLine.text).length };
    }
    const comment = endComment(source, options, index);
    if (comment) {
        const marker = comment.marker.trimEnd();
        if (content.startsWith(marker)) {
            const rest = content.slice(marker.length);
            const dropped = next + marker.length + (rest.startsWith(' ') ? 1 : 0);
            const remainder = rest.startsWith(' ') ? rest.slice(1) : rest;
            return { from: trimmedEnd, to: dropped, text: remainder === '' ? '' : ' ', caret: 0 };
        }
    }
    return { from: trimmedEnd, to: next, text: spacingBetween(source.slice(left.start, trimmedEnd), content), caret: 0 };
}

/*
 * Joins each line with the next, or the lines of a selection into one. The break and the whitespace
 * around it become a space, a `//` comment line joined to another loses its second marker and the
 * end of line comment of a line that code follows becomes a block comment.
 */
export function planJoinLines(source: EditSource, selections: readonly Selection[], options: LineCommandOptions): EditPlan | null {
    interface Range {
        first: number;
        count: number;
    }
    const ranges: Range[] = [];
    for (const selection of selections) {
        const { from, to } = rangeOf(selection);
        const first = source.lineAt(from);
        let last = from === to ? first + 1 : source.lineAt(to);
        if (from !== to && last > first && source.line(last).start === to) {
            last--;
        }
        if (last >= source.lineCount) {
            continue;
        }
        const previous = ranges.at(-1);
        if (previous && first <= previous.first + previous.count) {
            previous.count = Math.max(previous.count, last - previous.first);
        } else {
            ranges.push({ first, count: last - first });
        }
    }
    const edits: TextEdit[] = [];
    const carets: { at: number; extra: number }[] = [];
    for (const range of ranges) {
        let line = range.first;
        for (let done = 0; done < range.count && line < source.lineCount - 1; done++) {
            const join = joinAfter(source, options, line);
            if (!join) {
                break;
            }
            const comment = endComment(source, options, line);
            const nextStart = skipWhitespace(source, source.line(line).end);
            const nextLine = source.line(source.lineAt(nextStart));
            const converts =
                comment !== null &&
                !isBlank(source.slice(source.line(line).start, comment.start)) &&
                !source.slice(nextStart, nextLine.end).startsWith(comment.marker.trimEnd()) &&
                commentSyntax(options.language, source.region(line)).block?.open === '/*';
            if (converts && comment) {
                const body = source.slice(comment.start + comment.marker.length, join.from);
                if (!body.includes('*/')) {
                    edits.push({ from: comment.start, to: comment.start + comment.marker.length, text: '/*' });
                    const closing = (body.startsWith(' ') && !body.endsWith(' ') ? ' ' : '') + '*/';
                    edits.push({ from: join.from, to: join.to, text: closing + join.text });
                    carets.push({ at: join.from, extra: closing.length });
                    line = source.lineAt(nextStart);
                    continue;
                }
            }
            edits.push({ from: join.from, to: join.to, text: join.text });
            carets.push({ at: join.from, extra: join.caret });
            line = source.lineAt(nextStart);
        }
    }
    if (edits.length === 0) {
        return null;
    }
    edits.sort((left, right) => left.from - right.from);
    const result = selections.map((selection) => {
        const { from, to } = rangeOf(selection);
        if (from !== to) {
            const end = mapOffset(to, edits);
            return { anchor: end, head: end };
        }
        const line = source.line(source.lineAt(from));
        const caret = carets.find((entry) => entry.at >= line.start && entry.at <= line.end);
        const base = caret ? caret.at + shiftBefore(caret.at, edits) + caret.extra : mapOffset(from, edits);
        return { anchor: base, head: base };
    });
    return { edits, selections: result };
}

/* The identifier characters around an offset. */
function wordAround(source: EditSource, offset: number): { from: number; to: number } {
    const line = source.line(source.lineAt(offset));
    const column = offset - line.start;
    let from = column;
    let to = column;
    while (from > 0 && identifier.test(line.text[from - 1]!)) {
        from--;
    }
    while (to < line.text.length && identifier.test(line.text[to]!)) {
        to++;
    }
    return { from: line.start + from, to: line.start + to };
}

/* A string escape such as `\n` stays as written. */
function convertCase(text: string, lower: boolean, inString: boolean): string {
    const convert = (part: string): string => (lower ? part.toLowerCase() : part.toUpperCase());
    if (!inString) {
        return convert(text);
    }
    return text
        .split(/(\\(?:u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.))/)
        .map((part, index) => (index % 2 === 1 ? part : convert(part)))
        .join('');
}

/*
 * Flips the case of what is selected, or of the word at a caret with nothing selected, which stays
 * selected. Text with any capital turns to lower case, and text without turns to upper case; with
 * several carets one answer goes for all of them.
 */
export function planToggleCase(source: EditSource, selections: readonly Selection[]): EditPlan | null {
    const targets = selections.map((selection) => {
        const { from, to } = rangeOf(selection);
        return from === to ? { ...wordAround(source, from), word: true } : { from, to, word: false };
    });
    const texts = targets.map((target) => source.slice(target.from, target.to));
    const lower = texts.some((text) => text !== text.toLowerCase());
    const edits: TextEdit[] = [];
    const result: Selection[] = [];
    let delta = 0;
    for (const [index, target] of targets.entries()) {
        const context: TypingContext = source.context(target.from);
        const inString = context.mode === 'quote' || context.mode === 'template';
        const converted = convertCase(texts[index]!, lower, inString);
        if (converted !== texts[index]) {
            edits.push({ from: target.from, to: target.to, text: converted });
        }
        const selection = selections[index]!;
        const reversed = selection.anchor > selection.head;
        const start = target.from + delta;
        const end = target.from + delta + converted.length;
        result.push(target.word || !reversed ? { anchor: start, head: end } : { anchor: end, head: start });
        delta += converted.length - texts[index]!.length;
    }
    if (targets.every((target) => target.from === target.to)) {
        return null;
    }
    return { edits, selections: result };
}

interface Frame {
    opener: number;
    closer: string;
}

/* The brackets still open at the start of a line, innermost first. */
function frames(context: TypingContext): Frame[] {
    const result: Frame[] = [];
    for (let bracket = context.bracket; bracket; bracket = bracket.previous) {
        result.push({ opener: bracket.at, closer: bracket.close });
    }
    return result;
}

const caseLabel = /^(?:case\b[^]*|default)\s*:$/;

/*
 * Sets the indentation of the lines to what their brackets say: a line is one level in from the line
 * its innermost bracket opened on, a closing bracket lines up with it, the lines of a case follow
 * their label and a line after an unfinished statement goes in once. Lines in comments and strings,
 * and in languages that are not bracketed, are left alone.
 */
export function planAutoIndent(source: EditSource, lines: readonly number[], options: LineCommandOptions): EditPlan | null {
    if (!indentsByBrackets(options.language)) {
        return null;
    }
    const indents = new Map<number, string>();
    const indentOf = (line: number): string => indents.get(line) ?? whitespaceOf(source.line(line).text);
    const edits: TextEdit[] = [];
    const isMarkup = markupGuard(source, options.language);
    for (const line of lines) {
        const bounds = source.line(line);
        const context = source.context(bounds.start);
        if (isBlank(bounds.text) || context.mode !== 'code' || isMarkup(line)) {
            continue;
        }
        const target = targetIndent(source, options, line, context, indentOf);
        indents.set(line, target);
        const current = whitespaceOf(bounds.text);
        if (current !== target) {
            edits.push({ from: bounds.start, to: bounds.start + current.length, text: target });
        }
    }
    return edits.length === 0 ? null : { edits, selections: [] };
}

function targetIndent(source: EditSource, options: LineCommandOptions, line: number, context: TypingContext, indentOf: (line: number) => string): string {
    const text = source.line(line).text.trimStart();
    const open = frames(context);
    const innermost = open[0];
    if (innermost && text.startsWith(innermost.closer)) {
        return indentOf(source.lineAt(innermost.opener));
    }
    let base = innermost ? indentOf(source.lineAt(innermost.opener)) + options.unit : '';
    if (innermost?.closer === '}' && !caseLabel.test(text)) {
        const label = openCaseLabel(source, line, context.bracket);
        if (label !== null) {
            base = indentOf(label) + options.unit;
        }
    }
    const previous = previousCodeLine(source, line);
    if (previous !== null && source.context(source.line(previous).start).bracket === context.bracket && lineContinues(source, options, previous)) {
        return isContinuation(source, options, previous) ? indentOf(previous) : indentOf(previous) + options.unit;
    }
    return base;
}

function lineContinues(source: EditSource, options: LineCommandOptions, line: number): boolean {
    const bounds = source.line(line);
    const text = bounds.text.trimEnd();
    return text.length > 0 && continues(text, source.context(bounds.start + text.length), options.language);
}

/* Whether the line goes on with a statement the line before it left open. */
function isContinuation(source: EditSource, options: LineCommandOptions, line: number): boolean {
    const previous = previousCodeLine(source, line);
    return (
        previous !== null &&
        source.context(source.line(previous).start).bracket === source.context(source.line(line).start).bracket &&
        lineContinues(source, options, previous)
    );
}

function previousCodeLine(source: EditSource, line: number): number | null {
    for (let candidate = line - 1; candidate >= 0; candidate--) {
        if (!isBlank(source.line(candidate).text)) {
            return candidate;
        }
    }
    return null;
}

/* Whether `bracket` is `outer` or sits inside it. */
function within(bracket: TypingContext['bracket'], outer: TypingContext['bracket']): boolean {
    for (let current = bracket; ; current = current.previous) {
        if (current === outer) {
            return true;
        }
        if (!current) {
            return false;
        }
    }
}

/* The line of the `case` label the lines of this block run under, if there is one. */
function openCaseLabel(source: EditSource, line: number, block: TypingContext['bracket']): number | null {
    for (let candidate = line - 1; candidate >= 0 && candidate >= line - 200; candidate--) {
        const bounds = source.line(candidate);
        if (isBlank(bounds.text)) {
            continue;
        }
        const state = source.context(bounds.start).bracket;
        if (!within(state, block)) {
            return null;
        }
        if (state === block && caseLabel.test(bounds.text.trim())) {
            return candidate;
        }
    }
    return null;
}
