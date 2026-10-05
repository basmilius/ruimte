import type { EditSource } from './edit-source.ts';
import { commentSyntax } from './languages.ts';
import { hasHashComments, isBraced, isPhp } from './lexical.ts';
import { hasJsx, isJsxAttributeValue } from './markup-regions.ts';
import type { DocumentLine } from './rope.ts';
import { indentationColumn } from './structure.ts';
import type { TypingContext } from './typing-context.ts';

export interface EnterOptions {
    language: string;
    /* One level of indentation. */
    unit: string;
    tabSize: number;
    /* Plain Enter: a new line at the indentation of this one. */
    smart: boolean;
    /* The plan may touch text away from the caret. Off when several carets could meet. */
    reach: boolean;
}

/* The text that replaces `[from, to)` and where the caret lands in it. */
export interface EnterPlan {
    from: number;
    to: number;
    text: string;
    caret: number;
}

const closers: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
const concatenation = new Map<string, string>();
for (const id of 'typescript javascript typescriptreact javascriptreact tsx jsx ts js java csharp cs kotlin scala dart swift go groovy'.split(' ')) {
    concatenation.set(id, '+');
}
concatenation.set('php', '.');

const markupLanguages = /^(html|xml|svg|vue|svelte|astro|mdx|jsx|tsx|javascriptreact|typescriptreact)$/i;
const voidElements = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
const trailingOperator = /(?:=>|&&|\|\||\?\?|[=*%?|&]|(?<!\+)\+|(?<!-)-)$/;
const lookBack = 50;
/* The longest text a JSX attribute is looked for in on an Enter. */
const jsxScanLimit = 2_000_000;
/* How far past the caret a comment is searched for its end. */
const commentReach = 20_000;

function whitespaceOf(text: string): string {
    return /^[\t ]*/.exec(text)![0];
}

function isBlank(text: string): boolean {
    return /^[\t ]*$/.test(text);
}

function escapeForPattern(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/*
 * Whether the code before `end` leaves its statement open: after the parenthesis of a braceless
 * `if` or `for`, after `else`, `=>` or a binary operator. Languages with braces only.
 */
export function continues(text: string, context: TypingContext, language: string): boolean {
    if (!isBraced(language) || context.mode !== 'code') {
        return false;
    }
    if (context.word === 'control-close' || context.word === 'else' || context.word === 'do') {
        return true;
    }
    if (isPhp(language) && /(?<!\.)\.$/.test(text)) {
        return true;
    }
    return trailingOperator.test(text);
}

class Enter {
    private readonly source: EditSource;
    private readonly options: EnterOptions;

    constructor(source: EditSource, options: EnterOptions) {
        this.source = source;
        this.options = options;
    }

    plan(from: number, to: number): EnterPlan {
        const { source, options } = this;
        const index = source.lineAt(from);
        const line = source.line(index);
        const before = source.slice(line.start, from);
        const leading = whitespaceOf(before);
        const newline = source.newline(index);
        if (!options.smart) {
            return { from, to, text: newline + leading, caret: newline.length + leading.length };
        }
        const context = source.context(from);
        const selection = from !== to;
        const planned =
            context.mode === 'block-comment'
                ? this.inBlockComment(from, to, context, index)
                : context.mode === 'line-comment' && !selection
                  ? this.inLineComment(from, context, index)
                  : context.mode === 'quote' && !selection
                    ? this.inString(from, context, index)
                    : null;
        return planned ?? this.inCode(from, to, context, index);
    }

    /* The indentation a new statement after this line gets, which is not the line's own when the line is a continuation. */
    private baseIndent(index: number, depth = 0): string {
        const line = this.source.line(index);
        const own = whitespaceOf(line.text);
        const previous = this.previousCodeLine(index);
        if (previous === null || depth > lookBack || !this.lineContinues(previous)) {
            return own;
        }
        return this.baseIndent(previous, depth + 1);
    }

    private previousCodeLine(index: number): number | null {
        for (let candidate = index - 1; candidate >= 0 && candidate >= index - lookBack; candidate--) {
            if (!isBlank(this.source.line(candidate).text)) {
                return candidate;
            }
        }
        return null;
    }

    private lineContinues(index: number): boolean {
        const line = this.source.line(index);
        const text = line.text.trimEnd();
        return text.length > 0 && continues(text, this.source.context(line.start + text.length), this.options.language);
    }

    private inCode(from: number, to: number, lineContext: TypingContext, index: number): EnterPlan {
        const { source, options } = this;
        const line = source.line(index);
        const before = source.slice(line.start, from);
        const leading = whitespaceOf(before);
        const newline = source.newline(index);
        const { unit, language } = options;
        // A comment that trails the code is not part of what decides the indentation.
        const commentAt = lineContext.mode === 'line-comment' ? lineContext.commentStart : undefined;
        const trailing = commentAt !== undefined && commentAt >= line.start && !isBlank(source.slice(line.start, commentAt));
        const trimmed = trailing ? source.slice(line.start, commentAt).trimEnd() : before.trimEnd();
        const context = trailing ? source.context(line.start + trimmed.length) : lineContext;
        const last = trimmed.at(-1) ?? '';
        const rest = source.slice(to, line.end);
        const afterWhitespace = to + whitespaceOf(rest).length;
        const next = source.charAt(afterWhitespace);
        const base = context.mode === 'code' ? this.baseIndent(index) : leading;
        const start = leading.length < before.length ? base : leading;
        const plain = (indent: string): EnterPlan => ({ from, to: afterWhitespace, text: newline + indent, caret: newline.length + indent.length });

        if (context.mode !== 'code') {
            return plain(leading);
        }

        const opener = closers[last] !== undefined && context.bracket?.close === closers[last] && context.bracket.at === line.start + trimmed.length - 1;
        if (opener) {
            const inner = start + unit;
            if (next === closers[last]) {
                return { from, to: afterWhitespace, text: newline + inner + newline + start, caret: newline.length + inner.length };
            }
            const closing =
                last === '{' && source.unmatchedBrace(context.bracket!.at) ? this.closeBrace(from, afterWhitespace, line, rest, newline, start, inner) : null;
            return closing ?? plain(inner);
        }

        const tag = this.openTag(trimmed, index);
        if (tag) {
            const inner = start + unit;
            if (new RegExp(`^</${escapeForPattern(tag)}\\s*>`, 'i').test(source.slice(afterWhitespace, line.end))) {
                return { from, to: afterWhitespace, text: newline + inner + newline + start, caret: newline.length + inner.length };
            }
            return plain(inner);
        }

        if (this.opensIndentedBlock(trimmed, context)) {
            return plain(this.blockIndent(line.text, start) + unit);
        }

        if (continues(trimmed, context, language)) {
            const continued = this.previousCodeLine(index) !== null && this.lineContinues(this.previousCodeLine(index)!);
            return plain(continued ? leading : start + unit);
        }
        return plain(start);
    }

    /* The `}` of a `{` that nothing closes goes under the line it opens, or after what follows the caret when that is a statement. */
    private closeBrace(
        from: number,
        afterWhitespace: number,
        line: DocumentLine,
        rest: string,
        newline: string,
        base: string,
        inner: string
    ): EnterPlan | null {
        const tail = rest.trimStart();
        if (tail === '' || /^[)\];,%<?]/.test(tail)) {
            const text = newline + inner + newline + base + '}';
            return { from, to: afterWhitespace, text, caret: newline.length + inner.length };
        }
        if (!this.options.reach) {
            return null;
        }
        const text = newline + inner + tail.trimEnd() + newline + base + '}';
        return { from, to: line.end, text, caret: newline.length + inner.length };
    }

    /* The name of the tag the text ends in, when it is an open tag with children to come. */
    private openTag(trimmed: string, index: number): string | null {
        const { language } = this.options;
        if (!markupLanguages.test(language)) {
            return null;
        }
        if (/^vue$/i.test(language) && this.source.region(index) === 'script') {
            return null;
        }
        const match = /(?:^|[^\w$)\]])<([A-Za-z][\w:.-]*)(?:\s(?:[^<>]|=>)*)?>$/.exec(trimmed);
        if (!match || trimmed.endsWith('/>') || (voidElements.test(match[1]!) && !/^xml$/i.test(language))) {
            return null;
        }
        return match[1]!;
    }

    /* Python's `def f():`, a YAML `key:` and a `case x:`. */
    private opensIndentedBlock(trimmed: string, context: TypingContext): boolean {
        const { language } = this.options;
        if (/^(python|py)$/i.test(language)) {
            return trimmed.endsWith(':') && context.bracket === undefined;
        }
        if (/^(yaml|yml)$/i.test(language)) {
            return /(?::|[|>][+-]?)$/.test(trimmed) && !trimmed.trimStart().startsWith('#');
        }
        if (isBraced(language)) {
            return (context.bracket === undefined || context.bracket.close === '}') && /^(?:case\b[^]*|default)\s*:$/.test(trimmed.trimStart());
        }
        return false;
    }

    /* A YAML list item's children line up with its key, not with its dash. */
    private blockIndent(text: string, start: string): string {
        if (!/^(yaml|yml)$/i.test(this.options.language)) {
            return start;
        }
        const dashes = /^[\t ]*(?:- +)+/.exec(text)?.[0];
        return dashes ? start + ' '.repeat(dashes.length - whitespaceOf(text).length) : start;
    }

    private inLineComment(from: number, context: TypingContext, index: number): EnterPlan | null {
        const { source, options } = this;
        const line = source.line(index);
        const commentStart = context.commentStart;
        const syntax = commentSyntax(options.language, source.region(index));
        // A hash comment of a language that has both, as in PHP, continues with its own marker.
        const token = commentStart !== undefined && hasHashComments(options.language) && source.charAt(commentStart) === '#' ? '#' : syntax.line;
        if (commentStart === undefined || commentStart < line.start || token === null) {
            return null;
        }
        const marker = new RegExp(`^${escapeForPattern(token)}${token === '//' ? '[/!]?' : token === '#' ? '#*' : ''}`).exec(
            source.slice(commentStart, line.end)
        )?.[0];
        if (marker === undefined || from < commentStart + marker.length) {
            return null;
        }
        const rest = source.slice(from, line.end);
        const textStart = from + whitespaceOf(rest).length;
        if (textStart >= line.end) {
            return null;
        }
        const newline = source.newline(index);
        const leading = whitespaceOf(source.slice(line.start, from));
        if (source.slice(textStart, textStart + token.length) === token) {
            return { from, to: textStart, text: newline + leading, caret: newline.length + leading.length };
        }
        const code = source.slice(line.start, commentStart);
        const onlyComment = isBlank(code);
        let spacing = ' ';
        if (onlyComment) {
            const gap = whitespaceOf(source.slice(commentStart + marker.length, line.end));
            spacing = gap === '' ? ' ' : gap;
        } else if (source.charAt(from) === ' ') {
            spacing = '';
        }
        const text = newline + leading + marker + spacing;
        return { from, to: textStart, text, caret: text.length };
    }

    private inString(from: number, context: TypingContext, index: number): EnterPlan | null {
        const { source, options } = this;
        const operator = concatenation.get(options.language.toLowerCase());
        const quote = context.quote;
        if (operator === undefined || (quote !== '"' && quote !== "'")) {
            return null;
        }
        const line = source.line(index);
        const opener = this.stringStart(line, from, quote);
        if (opener !== null && (this.isModulePath(line, opener, index) || this.isMarkupAttribute(opener))) {
            return null;
        }
        let at = from;
        if (context.escaped) {
            at += /^(?:u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/.exec(source.slice(from, line.end))?.[0].length ?? 0;
        }
        if (!this.closesOnLine(at, quote, line)) {
            return null;
        }
        const newline = source.newline(index);
        const previous = this.previousCodeLine(index);
        const leading = whitespaceOf(line.text);
        const continued = previous !== null && this.lineContinues(previous);
        const indent = continued ? leading : leading + options.unit;
        const text = `${quote} ${operator}${newline}${indent}${quote}`;
        const rest = source.slice(at, line.end);
        return { from: at, to: at + whitespaceOf(rest).length, text, caret: text.length };
    }

    /* Where the string the caret is in opened, when it opened on this line. */
    private stringStart(line: DocumentLine, from: number, quote: string): number | null {
        let open: { at: number; quote: string } | null = null;
        for (let at = line.start; at < from; at++) {
            const char = this.source.charAt(at);
            if (open === null) {
                if (char === '"' || char === "'" || char === '`') {
                    open = { at, quote: char };
                }
            } else if (char === '\\') {
                at++;
            } else if (char === open.quote) {
                open = null;
            }
        }
        return open?.quote === quote ? open.at : null;
    }

    /* A path an import, a `require` or an `export ... from` names, where a break and a concatenation would name another file. */
    private isModulePath(line: DocumentLine, opener: number, index: number): boolean {
        const before = this.source.slice(line.start, opener).trimEnd();
        if (/(?:^|[^\w$.])(?:import|from|require|require_once|include|include_once)\s*\(?$/.test(before)) {
            return true;
        }
        return /^go$/i.test(this.options.language) && before === '' && this.inGoImportBlock(index);
    }

    private inGoImportBlock(index: number): boolean {
        for (let candidate = index - 1; candidate >= 0 && candidate >= index - lookBack; candidate--) {
            const text = this.source.line(candidate).text.trim();
            if (/^import\s*\($/.test(text)) {
                return true;
            }
            if (text.startsWith(')')) {
                return false;
            }
        }
        return false;
    }

    /* The value of a JSX attribute, which has to stay one string. */
    private isMarkupAttribute(opener: number): boolean {
        if (!hasJsx(this.options.language)) {
            return false;
        }
        const last = this.source.line(this.source.lineCount - 1).end;
        return last <= jsxScanLimit && isJsxAttributeValue(this.source.slice(0, last), opener);
    }

    private closesOnLine(from: number, quote: string, line: DocumentLine): boolean {
        const text = this.source.slice(from, line.end);
        for (let at = 0; at < text.length; at++) {
            if (text[at] === '\\') {
                at++;
            } else if (text[at] === quote) {
                return true;
            }
        }
        return false;
    }

    private inBlockComment(from: number, to: number, context: TypingContext, index: number): EnterPlan | null {
        const { source, options } = this;
        const syntax = commentSyntax(options.language, source.region(index));
        const open = context.commentStart;
        if (syntax.block?.open !== '/*' || open === undefined || from < open + 2) {
            return null;
        }
        const startIndex = source.lineAt(open);
        const startLine = source.line(startIndex);
        const line = source.line(index);
        const code = source.slice(startLine.start, open);
        const lead = this.commentLead(code);
        const newline = source.newline(index);
        const closeAt = this.closingOf(open, from);
        const isDoc = source.slice(open, open + 3) === '/**' && source.slice(open, open + 4) !== '/**/';
        const caretText = line.text.trimStart();
        const onStar = index > startIndex && caretText.startsWith('*') && !caretText.startsWith('*/');
        const onOpener = index === startIndex;
        const rest = source.slice(to, line.end);
        const textStart = to + whitespaceOf(rest).length;

        if (closeAt === null) {
            const star = onOpener || onStar ? this.starPrefix(line, lead, onStar, isDoc) : whitespaceOf(line.text);
            const tail = source.slice(textStart, line.end).trimEnd();
            const closer = `${newline}${lead} */`;
            if (options.reach) {
                const text = newline + star + tail + closer;
                return { from, to: line.end, text, caret: newline.length + star.length };
            }
            return { from, to: textStart, text: newline + star, caret: newline.length + star.length };
        }
        if (isDoc && onOpener && source.lineAt(closeAt) === index && isBlank(source.slice(to, closeAt)) && isBlank(source.slice(closeAt + 2, line.end))) {
            // Nothing left to say after the caret: the closer gets a line of its own, under the opener's star.
            const star = this.starPrefix(line, lead, false, isDoc);
            return { from, to: line.end, text: `${newline}${star}${newline}${lead} */`, caret: newline.length + star.length };
        }
        const second = source.line(startIndex + 1).text.trimStart();
        const continuesStars = onOpener ? isDoc : second.startsWith('*') && !second.startsWith('*/');
        if (!continuesStars) {
            return null;
        }
        const star = this.starPrefix(line, lead, onStar, isDoc);
        return { from, to: textStart, text: newline + star, caret: newline.length + star.length };
    }

    /* The whitespace that puts a star under the first star of an opener that stands after `code`. */
    private commentLead(code: string): string {
        const indent = whitespaceOf(code);
        const gap = indentationColumn(code, this.options.tabSize) - indentationColumn(indent, this.options.tabSize);
        return indent + ' '.repeat(gap);
    }

    /* A line of a comment that starts with `*` keeps its own alignment and the indentation inside a doc comment; any other line gets the opener's. */
    private starPrefix(line: DocumentLine, lead: string, onStar: boolean, isDoc: boolean): string {
        if (!onStar) {
            return `${lead} * `;
        }
        const inside = /^\*([\t ]*)/.exec(line.text.trimStart())?.[1] ?? '';
        return `${whitespaceOf(line.text)}*${isDoc && inside !== '' ? inside : ' '}`;
    }

    /* Where the comment opened at `open` ends after `from`, or null when it runs on or swallows another comment. */
    private closingOf(open: number, from: number): number | null {
        const text = this.source.slice(from, from + commentReach);
        const close = text.indexOf('*/');
        if (close < 0) {
            return null;
        }
        return this.source.slice(open + 2, from + close).includes('/*') ? null : from + close;
    }
}

/* Where one Enter puts its break and caret, as a replacement of text around the caret. */
export function planEnter(source: EditSource, from: number, to: number, options: EnterOptions): EnterPlan {
    return new Enter(source, options).plan(from, to);
}
