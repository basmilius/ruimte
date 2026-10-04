import type { EditSource } from './edit-source.ts';

/* A change of text in one place and where the caret stands in what replaces it. */
export interface HandlerEdit {
    from: number;
    to: number;
    text: string;
    caret: number;
}

const quotes = /["'`]/;

export function isQuote(character: string): boolean {
    return quotes.test(character);
}

/* Every quote of a body with whether a backslash escapes it. */
function quotesIn(body: string, selected: string, typed: string): { index: number; escaped: boolean }[] {
    const found: { index: number; escaped: boolean }[] = [];
    let escaped = false;
    for (let index = 0; index < body.length; index++) {
        const character = body[index]!;
        if (escaped) {
            if (character === selected || character === typed) {
                found.push({ index, escaped: true });
            }
            escaped = false;
        } else if (character === '\\') {
            escaped = true;
        } else if (character === selected || character === typed) {
            found.push({ index, escaped: false });
        }
    }
    return found;
}

/* The string that has the quote at `offset` for its opening or its closing quote, on that line. */
function stringAround(source: EditSource, offset: number, quote: string): { start: number; end: number } | null {
    const line = source.line(source.lineAt(offset));
    const before = source.context(offset);
    const after = source.context(offset + 1);
    const inString = (mode: string): boolean => mode === 'quote' || mode === 'template';
    if (before.mode === 'code' && inString(after.mode) && after.quote === quote) {
        const text = source.slice(offset + 1, line.end);
        for (let at = 0; at < text.length; at++) {
            if (text[at] === '\\') {
                at++;
            } else if (text[at] === quote) {
                return { start: offset, end: offset + 1 + at };
            }
        }
        return null;
    }
    if (inString(before.mode) && before.quote === quote && !before.escaped && after.mode === 'code') {
        const text = source.slice(line.start, offset);
        for (let at = text.length - 1; at >= 0; at--) {
            let slashes = 0;
            while (at - slashes - 1 >= 0 && text[at - slashes - 1] === '\\') {
                slashes++;
            }
            if (text[at] === quote && slashes % 2 === 0) {
                return { start: line.start + at, end: offset };
            }
        }
    }
    return null;
}

/*
 * A quote typed over a selected quote of a string turns that string's own quotes into the typed
 * one, escaping the typed quote inside it and unescaping the old one.
 */
export function swapQuotes(source: EditSource, offset: number, typed: string): HandlerEdit | null {
    const selected = source.charAt(offset);
    if (selected === typed || !isQuote(selected) || !isQuote(typed)) {
        return null;
    }
    const span = stringAround(source, offset, selected);
    if (!span) {
        return null;
    }
    const body = source.slice(span.start + 1, span.end);
    const inside = quotesIn(body, selected, typed);
    const interpolated = selected === '`' && body.includes('${');
    if (interpolated && inside.length > 0) {
        return null;
    }
    let rewritten = body;
    if (!interpolated) {
        let shift = 0;
        for (const { index, escaped } of inside) {
            const character = body[index]!;
            if (character === typed && !escaped) {
                rewritten = rewritten.slice(0, index + shift) + '\\' + rewritten.slice(index + shift);
                shift++;
            } else if (character === selected && escaped) {
                rewritten = rewritten.slice(0, index + shift - 1) + rewritten.slice(index + shift);
                shift--;
            }
        }
    }
    const text = typed + rewritten + typed;
    return { from: span.start, to: span.end + 1, text, caret: offset === span.start ? 1 : text.length };
}

const comparison = /^[<>=!]+$/;

/* Whether typing `<` or `>` over this selection replaces an operator, as `<` over `==` does. */
export function replacesComparison(typed: string, selected: string, inCommentOrString: boolean): boolean {
    return (typed === '<' || typed === '>') && selected.length <= 3 && comparison.test(selected) && !inCommentOrString;
}

const closerOf: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}', '<': '>', '"': '"', "'": "'", '`': '`' };

export function matchingDelimiter(character: string): string {
    return closerOf[character] ?? character;
}

function similarDelimiters(left: string, right: string): boolean {
    const bracket = (character: string): boolean => /[([{<]/.test(character);
    return (bracket(left) && bracket(right)) || (isQuote(left) && isQuote(right));
}

/*
 * What a delimiter typed over a selection makes of it: the selection between the new delimiters. A
 * selection that already has delimiters of the same kind swaps them for the typed ones.
 */
export function surround(selected: string, typed: string): { text: string; inner: string } {
    let inner = selected;
    if (selected.length > 1) {
        const first = selected[0]!;
        const last = selected.at(-1)!;
        if (
            similarDelimiters(first, typed) &&
            last === matchingDelimiter(first) &&
            (isQuote(first) || first !== typed) &&
            selected.indexOf(last, 1) === selected.length - 1
        ) {
            inner = selected.slice(1, -1);
        }
    }
    return { text: typed + inner + matchingDelimiter(typed), inner };
}
