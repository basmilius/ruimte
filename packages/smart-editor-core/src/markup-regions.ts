import type { EditSource } from './edit-source.ts';

const JSX_LANGUAGES = /^(typescriptreact|javascriptreact|tsx|jsx|javascript|js|mjs|cjs)$/i;
const NAME = /[\w$.:-]/;
const START_OF_NAME = /[A-Za-z_$>]/;
const EXPRESSION_KEYWORDS = /^(return|case|yield|await|default|typeof|void|delete|in|of|else|do)$/;
/* The characters after which an expression, and so a JSX element, may start. */
const EXPRESSION_STARTS = '(,=:[!&|?{>~^%*+-';
const CLOSERS: Readonly<Record<string, string>> = { '{': '}', '(': ')', '[': ']' };

/*
 * The stretches of a script that are JSX elements, as offsets, outermost first. A scanner and not a
 * parser: an element that does not close as one is left out, and a file that costs more than a few
 * passes over its text gives up with what it found.
 */
class JsxScanner {
    readonly ranges: { from: number; to: number }[] = [];
    /* The quoted values of attributes, quotes included. */
    readonly values: { from: number; to: number }[] = [];
    private readonly text: string;
    private depth = 0;
    private budget: number;

    constructor(text: string) {
        this.text = text;
        this.budget = text.length * 12 + 1_000;
    }

    scan(): void {
        this.code(0, null);
    }

    /* Reads code up to the closer that ends it and returns the offset after it; -1 when it never closes as it should. */
    private code(from: number, closer: string | null): number {
        const { text } = this;
        let at = from;
        let previous = '';
        let word = '';
        while (at < text.length) {
            if (--this.budget < 0) {
                return -1;
            }
            const char = text[at]!;
            const next = text[at + 1];
            if (/\s/.test(char)) {
                at++;
                continue;
            }
            if (char === '/' && next === '/') {
                const end = text.indexOf('\n', at);
                at = end < 0 ? text.length : end;
                continue;
            }
            if (char === '/' && next === '*') {
                const end = text.indexOf('*/', at + 2);
                at = end < 0 ? text.length : end + 2;
                continue;
            }
            if (char === '"' || char === "'") {
                at = this.quoted(at);
                previous = char;
                word = '';
                continue;
            }
            if (char === '`') {
                at = this.template(at);
                if (at < 0) {
                    return -1;
                }
                previous = char;
                word = '';
                continue;
            }
            const expressionStart = previous === '' || EXPRESSION_STARTS.includes(previous) || EXPRESSION_KEYWORDS.test(word);
            if (char === '/' && expressionStart) {
                at = this.regex(at);
                previous = '/';
                word = '';
                continue;
            }
            if (char === '<' && expressionStart && next !== undefined && START_OF_NAME.test(next)) {
                const end = this.element(at, true);
                if (end >= 0) {
                    at = end;
                    previous = ')';
                    word = '';
                    continue;
                }
            }
            const closes = CLOSERS[char];
            if (closes !== undefined) {
                const end = this.code(at + 1, closes);
                if (end < 0) {
                    return -1;
                }
                at = end;
                previous = closes;
                word = '';
                continue;
            }
            if (char === '}' || char === ')' || char === ']') {
                if (closer === char) {
                    return at + 1;
                }
                if (closer !== null) {
                    return -1;
                }
                at++;
                previous = char;
                word = '';
                continue;
            }
            if (/[\w$]/.test(char)) {
                const start = at;
                while (at < text.length && /[\w$]/.test(text[at]!)) {
                    at++;
                }
                word = text.slice(start, at);
                previous = word.slice(-1);
                continue;
            }
            previous = char;
            word = '';
            at++;
        }
        return closer === null ? text.length : -1;
    }

    private quoted(from: number): number {
        const { text } = this;
        const quote = text[from]!;
        let at = from + 1;
        while (at < text.length && text[at] !== quote && text[at] !== '\n') {
            at += text[at] === '\\' ? 2 : 1;
        }
        return Math.min(text.length, at + 1);
    }

    private template(from: number): number {
        const { text } = this;
        let at = from + 1;
        while (at < text.length) {
            if (text[at] === '\\') {
                at += 2;
            } else if (text[at] === '`') {
                return at + 1;
            } else if (text[at] === '$' && text[at + 1] === '{') {
                at = this.code(at + 2, '}');
                if (at < 0) {
                    return -1;
                }
            } else {
                at++;
            }
        }
        return text.length;
    }

    private regex(from: number): number {
        const { text } = this;
        let at = from + 1;
        let inClass = false;
        while (at < text.length && text[at] !== '\n') {
            const char = text[at]!;
            if (char === '\\') {
                at++;
            } else if (char === '[') {
                inClass = true;
            } else if (char === ']') {
                inClass = false;
            } else if (char === '/' && !inClass) {
                return at + 1;
            }
            at++;
        }
        return from + 1;
    }

    /* An element from its `<`, recorded when no element holds it, and the offset after its closing tag; -1 when it is not one. */
    private element(from: number, outermost: boolean): number {
        this.depth++;
        const end = this.parse(from);
        this.depth--;
        if (end >= 0 && outermost && this.depth === 0) {
            this.ranges.push({ from, to: end });
        }
        return end;
    }

    private skipSpace(from: number): number {
        let at = from;
        while (at < this.text.length && /\s/.test(this.text[at]!)) {
            at++;
        }
        return at;
    }

    private parse(from: number): number {
        const { text } = this;
        let at = from + 1;
        while (at < text.length && NAME.test(text[at]!)) {
            at++;
        }
        const name = text.slice(from + 1, at);
        for (;;) {
            at = this.skipSpace(at);
            const char = text[at];
            if (char === undefined || --this.budget < 0) {
                return -1;
            }
            if (char === '/' && text[at + 1] === '>') {
                return at + 2;
            }
            if (char === '>') {
                at++;
                break;
            }
            if (char === '{') {
                at = this.code(at + 1, '}');
                if (at < 0) {
                    return -1;
                }
                continue;
            }
            if (!/[A-Za-z_$]/.test(char)) {
                return -1;
            }
            while (at < text.length && NAME.test(text[at]!)) {
                at++;
            }
            at = this.skipSpace(at);
            if (text[at] !== '=') {
                continue;
            }
            at = this.skipSpace(at + 1);
            const value = text[at];
            if (value === '"' || value === "'") {
                const close = text.indexOf(value, at + 1);
                if (close < 0) {
                    return -1;
                }
                this.values.push({ from: at, to: close + 1 });
                at = close + 1;
            } else if (value === '{') {
                at = this.code(at + 1, '}');
            } else if (value === '<' && START_OF_NAME.test(text[at + 1] ?? '')) {
                at = this.parse(at);
            } else {
                return -1;
            }
            if (at < 0) {
                return -1;
            }
        }
        for (;;) {
            while (at < text.length && text[at] !== '<' && text[at] !== '{') {
                at++;
            }
            if (at >= text.length || --this.budget < 0) {
                return -1;
            }
            if (text[at] === '{') {
                at = this.code(at + 1, '}');
            } else if (text[at + 1] === '/') {
                const closing = /^<\/\s*([\w$.:-]*)\s*>/.exec(text.slice(at, at + 200));
                return closing !== null && closing[1] === name ? at + closing[0].length : -1;
            } else if (START_OF_NAME.test(text[at + 1] ?? '')) {
                at = this.parse(at);
            } else {
                return -1;
            }
            if (at < 0) {
                return -1;
            }
        }
    }
}

/* The offsets of the JSX elements of a script, outermost first and in order. */
export function jsxRanges(text: string): { from: number; to: number }[] {
    const scanner = new JsxScanner(text);
    scanner.scan();
    return scanner.ranges;
}

/* Whether a language is one whose scripts can hold JSX. */
export function hasJsx(language: string): boolean {
    return JSX_LANGUAGES.test(language);
}

/* Whether the string that opens at `offset` is the value of a JSX attribute, which is markup and not a string expression. */
export function isJsxAttributeValue(text: string, offset: number): boolean {
    const scanner = new JsxScanner(text);
    scanner.scan();
    return scanner.values.some((value) => value.from === offset);
}

/*
 * Whether a line is markup that a command which works from the code around a line must leave as it
 * is: a Vue template and everything outside its script and style blocks, and the elements of JSX
 * with what stands inside them. The HTML of a PHP file and heredocs are modes of the lexer.
 */
export function markupGuard(source: EditSource, language: string): (line: number) => boolean {
    const id = language.toLowerCase();
    if (id === 'vue') {
        return (line) => {
            const region = source.region(line);
            return (region !== 'script' && region !== 'style') || /^\s*<\/?(?:script|style|template)\b/.test(source.line(line).text);
        };
    }
    if (hasJsx(id)) {
        const ranges = jsxRanges(source.slice(0, source.line(source.lineCount - 1).end));
        return (line) => {
            const bounds = source.line(line);
            const start = bounds.start + (/^[\t ]*/.exec(bounds.text)?.[0].length ?? 0);
            let low = 0;
            let high = ranges.length - 1;
            while (low <= high) {
                const middle = (low + high) >> 1;
                const range = ranges[middle]!;
                if (start < range.from) {
                    high = middle - 1;
                } else if (start >= range.to) {
                    low = middle + 1;
                } else {
                    return true;
                }
            }
            return false;
        };
    }
    return () => false;
}
