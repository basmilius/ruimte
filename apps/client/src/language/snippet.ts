/* A tab stop of a snippet: its index, and where it stands in the text the snippet inserts. */
export interface SnippetStop {
    readonly index: number;
    /* UTF-16 offsets into the inserted text; equal for a stop that holds no text. */
    readonly start: number;
    readonly end: number;
}

export interface ParsedSnippet {
    readonly text: string;
    /* In text order, a stop of the same index again being a mirror, which is not edited along. */
    readonly stops: readonly SnippetStop[];
}

const NAME = '[A-Za-z_]\\w*';
const TABSTOP = new RegExp(`^\\$(\\d+)|^\\$\\{(\\d+)\\}`);
const PLACEHOLDER = /^\$\{(\d+):/;
const CHOICE = /^\$\{(\d+)\|/;
const DEFAULT_VARIABLE = new RegExp(`^\\$\\{${NAME}:`);
const TRANSFORMED_VARIABLE = new RegExp(`^\\$\\{${NAME}/`);
const BARE_VARIABLE = new RegExp(`^\\$${NAME}|^\\$\\{${NAME}\\}`);

class SnippetParser {
    text = '';
    readonly stops: SnippetStop[] = [];
    private at = 0;
    private readonly source: string;

    constructor(source: string) {
        this.source = source;
    }

    parse(): ParsedSnippet {
        this.sequence(false);
        return { text: this.text, stops: this.stops };
    }

    /* Text up to the `}` that closes the placeholder this is in, which is left for the caller. */
    private sequence(nested: boolean): void {
        while (this.at < this.source.length) {
            const character = this.source[this.at]!;
            if (character === '}' && nested) {
                return;
            }
            if (character === '\\' && /[\\$}]/.test(this.source[this.at + 1] ?? '')) {
                this.text += this.source[this.at + 1];
                this.at += 2;
            } else if (character === '$') {
                this.dollar();
            } else {
                this.text += character;
                this.at++;
            }
        }
    }

    private dollar(): void {
        const rest = this.source.slice(this.at);
        const tabstop = TABSTOP.exec(rest);
        const placeholder = PLACEHOLDER.exec(rest);
        const choice = CHOICE.exec(rest);
        if (tabstop !== null) {
            this.at += tabstop[0].length;
            this.stops.push({ index: Number(tabstop[1] ?? tabstop[2]), start: this.text.length, end: this.text.length });
        } else if (placeholder !== null) {
            this.at += placeholder[0].length;
            const start = this.text.length;
            this.sequence(true);
            this.closeBrace();
            this.stops.push({ index: Number(placeholder[1]), start, end: this.text.length });
        } else if (choice !== null) {
            this.at += choice[0].length;
            const start = this.text.length;
            this.firstChoice();
            this.stops.push({ index: Number(choice[1]), start, end: this.text.length });
        } else if (DEFAULT_VARIABLE.test(rest)) {
            this.at += rest.indexOf(':') + 1;
            this.sequence(true);
            this.closeBrace();
        } else if (TRANSFORMED_VARIABLE.test(rest)) {
            this.skipBraces();
        } else if (BARE_VARIABLE.test(rest)) {
            this.at += BARE_VARIABLE.exec(rest)![0].length;
        } else {
            this.text += '$';
            this.at++;
        }
    }

    private closeBrace(): void {
        if (this.source[this.at] === '}') {
            this.at++;
        }
    }

    /* The first of `a,b,c|}`, and the rest dropped. */
    private firstChoice(): void {
        let first = true;
        while (this.at < this.source.length && !(this.source[this.at] === '|' && this.source[this.at + 1] === '}')) {
            const character = this.source[this.at]!;
            if (character === '\\' && /[\\,|]/.test(this.source[this.at + 1] ?? '')) {
                this.at++;
                if (first) {
                    this.text += this.source[this.at];
                }
            } else if (character === ',') {
                first = false;
            } else if (first) {
                this.text += character;
            }
            this.at++;
        }
        this.at += 2;
    }

    /* Past the `}` that closes a `${name/regex/format/}` variable, which inserts nothing here. */
    private skipBraces(): void {
        let depth = 0;
        while (this.at < this.source.length) {
            const character = this.source[this.at]!;
            this.at += character === '\\' ? 2 : 1;
            if (character === '{') {
                depth++;
            } else if (character === '}' && --depth === 0) {
                return;
            }
        }
    }
}

export function parseSnippet(snippet: string): ParsedSnippet {
    return new SnippetParser(snippet).parse();
}

/* The stops in the order Tab visits them: 1, 2 and on, one per index, then the final stop `$0`, which the end of the text stands in for. */
export function tabOrder(parsed: ParsedSnippet): SnippetStop[] {
    const first = new Map<number, SnippetStop>();
    for (const stop of parsed.stops) {
        const known = first.get(stop.index);
        if (known === undefined || stop.start < known.start) {
            first.set(stop.index, stop);
        }
    }
    const visited = [...first.values()].filter((stop) => stop.index > 0).sort((left, right) => left.index - right.index);
    const final = first.get(0) ?? { index: 0, start: parsed.text.length, end: parsed.text.length };
    return [...visited, final];
}
