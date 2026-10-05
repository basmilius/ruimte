import { isImportLine } from './lexical-folds.ts';
import type { DocumentLine } from './rope.ts';
import type { FoldHints, FoldRole, FoldingRange } from './structure.ts';

const SCRIPT_LANGUAGES = /^(typescript|javascript|typescriptreact|javascriptreact|tsx|jsx|ts|js|mjs|cjs|mts|cts)$/i;
/* How far back from a bracket the text before it is read. */
const LOOK_BEHIND = 200;
/* A file header sits at the top, behind at most a shebang or an open tag and a blank line or two. */
const HEADER_LINES = 4;
/* Words an expression can follow, so a bracket after one is a value and not a block. */
const VALUE_WORDS = /\b(?:return|default|yield|await|of|in)$/;

/* A block comment that opens with two stars is documentation; `/**` closed at once is an empty one. */
export function commentRole(slice: (from: number, to: number) => string, from: number, to: number): FoldRole | undefined {
    return to - from > 4 && slice(from, from + 3) === '/**' ? 'doc-comment' : undefined;
}

/*
 * Whether a bracket opens an array or an object literal in a script, or a PHP attribute list, read from what
 * comes before it. A block (`) {`, `else {`) and an index (`items[`) have a word or a closer in front of them.
 */
export function bracketRole(slice: (from: number, to: number) => string, from: number, language: string): FoldRole | undefined {
    const opener = slice(from, from + 1);
    const before = slice(Math.max(0, from - LOOK_BEHIND), from);
    if (language.toLowerCase() === 'php') {
        return opener === '[' && before.endsWith('#') ? 'attribute' : undefined;
    }
    if (!SCRIPT_LANGUAGES.test(language) || (opener !== '{' && opener !== '[')) {
        return undefined;
    }
    const head = before.slice(before.lastIndexOf('\n') + 1);
    const trimmed = before.trimEnd();
    const previous = trimmed.at(-1);
    if (previous === undefined) {
        return undefined;
    }
    const arrow = trimmed.endsWith('=>');
    const value = (/[=:(,[?]/.test(previous) && !arrow) || VALUE_WORDS.test(trimmed) || (arrow && opener === '[');
    if (!value) {
        return undefined;
    }
    if (opener === '[') {
        return 'array-literal';
    }
    // A `case x: {` and a `type A = {` are a block and a type, not a value.
    return /^\s*(?:case\b|default\s*:|(?:export\s+)?(?:declare\s+)?(?:type|interface)\b)/.test(head) ? undefined : 'object-literal';
}

function isBlank(text: string): boolean {
    return text.trim() === '';
}

/*
 * The comment at the very top of a file is its header, unless it is the documentation of what follows
 * right under it. Only the first comment can be one, and only behind a shebang, an open tag or blank lines.
 */
export function markFileHeader(ranges: FoldingRange[], getLine: (line: number) => DocumentLine, lineCount: number, language: string): void {
    const candidate = ranges.find((range) => (range.kind === 'comment' || range.kind === 'line-comments') && range.startLine <= HEADER_LINES);
    if (candidate === undefined) {
        return;
    }
    for (let line = 0; line < candidate.startLine; line++) {
        const text = getLine(line).text;
        if (!isBlank(text) && !(line === 0 && /^(#!|<\?php\s*$)/.test(text))) {
            return;
        }
    }
    const start = getLine(candidate.startLine);
    if (candidate.from > start.start + (start.text.length - start.text.trimStart().length)) {
        return;
    }
    const next = candidate.endLine + 1 < lineCount ? getLine(candidate.endLine + 1).text : '';
    const attached = candidate.role === 'doc-comment' && !isBlank(next) && !isImportLine(language, next.trimStart());
    if (!attached) {
        candidate.role = 'file-header';
    }
}

/* The role a language server's range kind says, when the text under it says nothing else. */
function serverRole(kind: string | undefined, text: string): FoldRole | undefined {
    if (kind === 'imports') {
        return 'imports';
    }
    if (kind === 'region') {
        return 'region';
    }
    if (kind === 'comment') {
        return text.startsWith('/**') ? 'doc-comment' : undefined;
    }
    return text.startsWith('<') ? 'tag' : undefined;
}

/*
 * What a language server adds to the folds the text gives. A symbol names the body among the brackets: the
 * pair that closes where it ends, or the indented block that does. A range the text has no fold for becomes a
 * fold of its own, one per line it starts on, so the server's `{` block is not a second fold under the pair.
 */
export function applyFoldHints(
    ranges: readonly FoldingRange[],
    hints: FoldHints,
    lineAt: (offset: number) => number,
    getLine: (line: number) => DocumentLine,
    slice: (from: number, to: number) => string,
    minimum: number
): FoldingRange[] {
    const result = ranges.map((range) => ({ ...range }));
    for (const symbol of hints.symbols ?? []) {
        const startLine = lineAt(symbol.from);
        const endLine = lineAt(Math.max(symbol.from, symbol.to - 1));
        const body = bodyOf(result, symbol, startLine, endLine, slice);
        if (body !== undefined) {
            body.range.role = body.role;
        }
    }
    const starts = new Set(result.map((range) => range.startLine));
    for (const hint of hints.ranges ?? []) {
        const startLine = lineAt(hint.from);
        const endLine = lineAt(hint.to);
        if (endLine - startLine < minimum || starts.has(startLine)) {
            continue;
        }
        const first = getLine(startLine);
        const indent = first.text.length - first.text.trimStart().length;
        const role = serverRole(hint.kind, first.text.trimStart());
        starts.add(startLine);
        result.push({
            startLine,
            endLine,
            from: first.start + indent,
            to: getLine(endLine).end,
            kind: 'server',
            ...(role === undefined ? {} : { role })
        });
    }
    return result.sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
}

/* The fold that is the body of a symbol, and what kind of body it is. */
function bodyOf(
    ranges: FoldingRange[],
    symbol: { from: number; to: number; body: 'function' | 'method' | 'class' | 'value' },
    startLine: number,
    endLine: number,
    slice: (from: number, to: number) => string
): { range: FoldingRange; role: FoldRole } | undefined {
    const brace = ranges
        .filter((range) => range.kind === 'bracket' && range.from >= symbol.from && range.to <= symbol.to && slice(range.from, range.from + 1) === '{')
        .filter((range) => /^[\s;,]*$/.test(slice(range.to, symbol.to)))
        .sort((left, right) => right.to - left.to || left.from - right.from)[0];
    const range =
        brace ??
        ranges
            .filter((candidate) => candidate.kind === 'indentation' && candidate.endLine === endLine && candidate.startLine >= startLine)
            .sort((left, right) => left.startLine - right.startLine)[0];
    if (range === undefined) {
        return undefined;
    }
    if (symbol.body === 'class') {
        return { range, role: 'class-body' };
    }
    if (symbol.body === 'value') {
        const signature = slice(symbol.from, range.from);
        return /=>|\bfunction\b/.test(signature) ? { range, role: 'function-body' } : undefined;
    }
    return { range, role: symbol.body === 'method' ? 'method-body' : 'function-body' };
}
