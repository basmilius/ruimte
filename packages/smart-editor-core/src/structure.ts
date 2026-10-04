import { openers } from './lexical.ts';
import type { DocumentLine } from './rope.ts';

/* A bracket pair, string or block comment. `inner*` is the range without its delimiters. */
export interface StructureRange {
    from: number;
    to: number;
    innerFrom: number;
    innerTo: number;
    kind: 'bracket' | 'string' | 'comment';
}

/* Lines are zero-based and the offsets half-open. Fold from the end of `startLine` through `endLine`. */
export interface FoldingRange {
    startLine: number;
    endLine: number;
    from: number;
    to: number;
    kind: 'bracket' | 'comment' | 'indentation';
}

export interface FoldingOptions {
    /* On unless `false`. */
    brackets?: boolean;
    /* On unless `false`. */
    comments?: boolean;
    indentation?: boolean;
    tabSize?: number;
    /* How many lines a range spans past its first one before it can fold. */
    minLines?: number;
}

interface Header {
    line: number;
    indent: number;
}

/* Clamped to 1 through 16, with 4 for anything that is not a finite number. */
export function tabWidth(options: { tabSize?: number }): number {
    const requested = options.tabSize ?? 4;
    return Number.isFinite(requested) ? Math.max(1, Math.min(16, Math.trunc(requested))) : 4;
}

export function indentationColumn(text: string, tabSize: number): number {
    let column = 0;
    for (const character of text) {
        column += character === '\t' ? tabSize - (column % tabSize) : 1;
    }
    return column;
}

/* Outermost first. It knows only line and block comments and the three quote characters, so a regex literal can confuse it. */
export function scanStructure(text: string): StructureRange[] {
    const result: StructureRange[] = [];
    const stack: { from: number; closer: string }[] = [];
    for (let offset = 0; offset < text.length; offset++) {
        const character = text[offset]!;
        if (character === '/' && text[offset + 1] === '/') {
            const end = text.indexOf('\n', offset + 2);
            offset = end === -1 ? text.length : end;
        } else if (character === '/' && text[offset + 1] === '*') {
            const end = text.indexOf('*/', offset + 2);
            if (end === -1) {
                break;
            }
            result.push({ from: offset, to: end + 2, innerFrom: offset + 2, innerTo: end, kind: 'comment' });
            offset = end + 1;
        } else if (character === '"' || character === "'" || character === '`') {
            const start = offset;
            for (offset++; offset < text.length; offset++) {
                if (text[offset] === '\\') {
                    offset++;
                } else if (text[offset] === character) {
                    result.push({ from: start, to: offset + 1, innerFrom: start + 1, innerTo: offset, kind: 'string' });
                    break;
                } else if (character !== '`' && (text[offset] === '\n' || text[offset] === '\r')) {
                    break;
                }
            }
        } else if (openers[character]) {
            stack.push({ from: offset, closer: openers[character] });
        } else if (stack.at(-1)?.closer === character) {
            const opener = stack.pop()!;
            result.push({ from: opener.from, to: offset + 1, innerFrom: opener.from + 1, innerTo: offset, kind: 'bracket' });
        }
    }
    return result.sort((left, right) => left.from - right.from || right.to - left.to);
}

function indentationFolds(lineCount: number, getLine: (line: number) => DocumentLine, tabSize: number, minimum: number): FoldingRange[] {
    const folds: FoldingRange[] = [];
    const headers: Header[] = [];
    let previous: Header | undefined;

    const close = (header: Header, endLine: number): void => {
        if (endLine - header.line >= minimum) {
            folds.push({ from: getLine(header.line).start, to: getLine(endLine).end, startLine: header.line, endLine, kind: 'indentation' });
        }
    };

    for (let line = 0; line < lineCount; line++) {
        const text = getLine(line).text;
        if (!text.trim()) {
            continue;
        }
        const indent = indentationColumn(text.match(/^[\t ]*/)?.[0] ?? '', tabSize);
        while (headers.length > 0 && indent <= headers.at(-1)!.indent) {
            close(headers.pop()!, previous!.line);
        }
        if (previous && indent > previous.indent) {
            headers.push(previous);
        }
        previous = { line, indent };
    }
    while (headers.length > 0) {
        close(headers.pop()!, previous!.line);
    }
    return folds;
}

/* Ranges that span the same lines collapse into the first, which is the outermost. */
export function deriveFoldingRanges(
    ranges: readonly StructureRange[],
    lineAt: (offset: number) => number,
    lineCount: number,
    getLine: (line: number) => DocumentLine,
    options: FoldingOptions = {}
): FoldingRange[] {
    const minimum = options.minLines === undefined ? 1 : Math.max(1, Number.isFinite(options.minLines) ? Math.trunc(options.minLines) : 1);
    const result: FoldingRange[] = [];
    for (const range of ranges) {
        if (range.kind === 'string' || (range.kind === 'bracket' ? options.brackets === false : options.comments === false)) {
            continue;
        }
        const startLine = lineAt(range.from);
        const endLine = lineAt(range.to - 1);
        if (endLine - startLine >= minimum) {
            result.push({ from: range.from, to: range.to, startLine, endLine, kind: range.kind });
        }
    }
    if (options.indentation) {
        result.push(...indentationFolds(lineCount, getLine, tabWidth(options), minimum));
    }
    result.sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
    return result.filter((range, index) => index === 0 || range.startLine !== result[index - 1]!.startLine || range.endLine !== result[index - 1]!.endLine);
}
