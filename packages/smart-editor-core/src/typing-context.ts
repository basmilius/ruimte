import {
    hasBlockComments,
    hasHashComments,
    hasMarkupComments,
    hasSlashComments,
    isPhp,
    isScript,
    isWordCharacter,
    openers,
    startsExpression,
    startsExpressionAfter
} from './lexical.ts';
import type { DocumentLine } from './rope.ts';

export interface TypingBracket {
    at: number;
    close: string;
    previous?: TypingBracket;
    /** An `${` whose closer resumes the template text. */
    template?: boolean;
    /** The parenthesis of `if`, `for` and the like. */
    control?: boolean;
    /** A `{` that opens a block, as opposed to an object literal. */
    block?: boolean;
}

type Mode = 'code' | 'line-comment' | 'block-comment' | 'html-comment' | 'quote' | 'template' | 'regex';

/** What the lexer knows at one offset. Bracket stacks are immutable, so states share them. */
export interface TypingContext {
    mode: Mode;
    quote?: string;
    escaped: boolean;
    inClass: boolean;
    bracket?: TypingBracket;
    /** Whether an expression may start here, which makes a `/` a regex. */
    expression: boolean;
    /** The last word, or `control-close` after the parenthesis of a control statement. */
    word: string;
}

interface Rules {
    script: boolean;
    php: boolean;
    hash: boolean;
    slash: boolean;
    block: boolean;
    markup: boolean;
}

const controlWords = /^(for|for-await|if|while|switch|catch|with)$/;
const blockWords = /^(else|try|finally|do)$/;

function initial(): TypingContext {
    return { mode: 'code', escaped: false, inClass: false, expression: true, word: '' };
}

function rulesOf(language: string): Rules {
    return {
        script: isScript(language),
        php: isPhp(language),
        hash: hasHashComments(language),
        slash: hasSlashComments(language),
        block: hasBlockComments(language),
        markup: hasMarkupComments(language)
    };
}

function scanComment(state: TypingContext, text: string, at: number, end: number): number {
    const close = state.mode === 'block-comment' ? '*/' : '-->';
    if (at + close.length <= end && text.startsWith(close, at)) {
        state.mode = 'code';
        return at + close.length - 1;
    }
    return at;
}

function scanLiteral(state: TypingContext, text: string, at: number, end: number, offset: number): number {
    const char = text[at];
    if (state.escaped) {
        state.escaped = false;
    } else if (char === '\\') {
        state.escaped = true;
    } else if (state.mode === 'regex') {
        if (char === '[') {
            state.inClass = true;
        } else if (char === ']') {
            state.inClass = false;
        } else if (char === '/' && !state.inClass) {
            state.mode = 'code';
            state.expression = false;
        }
    } else if (state.mode === 'template' && char === '$' && text[at + 1] === '{' && at + 1 < end) {
        state.bracket = { at: offset + at + 1, close: '}', previous: state.bracket, template: true };
        state.mode = 'code';
        state.expression = true;
        state.word = '';
        return at + 1;
    } else if (char === state.quote) {
        state.mode = 'code';
        state.expression = false;
        state.quote = undefined;
    }
    return at;
}

function scanCode(state: TypingContext, rules: Rules, text: string, at: number, end: number, offset: number): number {
    const char = text[at];
    const next = text[at + 1];

    if (/\s/u.test(char)) {
        return at;
    }
    if (rules.markup && text.startsWith('<!--', at)) {
        state.mode = 'html-comment';
        return at + 3;
    }
    if (rules.hash && char === '#' && !(rules.php && next === '[')) {
        state.mode = 'line-comment';
        return at;
    }
    if (rules.slash && char === '/' && next === '/') {
        state.mode = 'line-comment';
        return at + 1;
    }
    if (rules.block && char === '/' && next === '*') {
        state.mode = 'block-comment';
        return at + 1;
    }
    if (char === '"' || char === "'" || char === '`') {
        state.mode = rules.script && char === '`' ? 'template' : 'quote';
        state.quote = char;
        state.escaped = false;
        state.word = '';
        return at;
    }
    if (rules.script && char === '/' && state.expression) {
        state.mode = 'regex';
        state.inClass = false;
        state.escaped = false;
        return at;
    }
    if ((char === '+' || char === '-') && next === char) {
        state.word = '';
        return at + 1;
    }
    if (openers[char]) {
        state.bracket = {
            at: offset + at,
            close: openers[char],
            previous: state.bracket,
            control: char === '(' && controlWords.test(state.word),
            block: char === '{' && (!state.expression || state.word === 'control-close' || blockWords.test(state.word))
        };
        state.expression = true;
        state.word = '';
    } else if (/[)\]}]/.test(char)) {
        closeBracket(state, char);
    } else if (isWordCharacter(char)) {
        const from = at;
        while (at + 1 < end && isWordCharacter(text[at + 1])) {
            at++;
        }
        const word = text.slice(from, at + 1);
        state.word = word === 'await' && state.word === 'for' ? 'for-await' : word;
        state.expression = startsExpression(word);
    } else {
        state.expression = startsExpressionAfter(char);
        state.word = '';
    }
    return at;
}

function closeBracket(state: TypingContext, char: string): void {
    const bracket = state.bracket;
    if (bracket?.close !== char) {
        state.bracket = undefined;
        state.expression = false;
        return;
    }
    state.bracket = bracket.previous;
    if (bracket.template) {
        state.mode = 'template';
        state.quote = '`';
    }
    state.expression = Boolean(bracket.control || bracket.block);
    state.word = bracket.control ? 'control-close' : '';
}

/** Lexes `text` up to `end`, from the state the line started in. `offset` is where the line starts in the document. */
function scan(text: string, end: number, start: TypingContext, rules: Rules, offset: number): TypingContext {
    const state = { ...start };
    for (let at = 0; at < end; at++) {
        if (state.mode === 'line-comment') {
            break;
        }
        if (state.mode === 'block-comment' || state.mode === 'html-comment') {
            at = scanComment(state, text, at, end);
        } else if (state.mode === 'code') {
            at = scanCode(state, rules, text, at, end, offset);
        } else {
            at = scanLiteral(state, text, at, end, offset);
        }
    }
    return state;
}

function sameState(left: TypingContext, right: TypingContext): boolean {
    return (
        left.mode === right.mode &&
        left.quote === right.quote &&
        left.escaped === right.escaped &&
        left.inClass === right.inClass &&
        left.bracket === right.bracket &&
        left.expression === right.expression &&
        left.word === right.word
    );
}

/** The state of the lexer at the start of each line, computed on demand. An edit drops the lines from its own on. */
export class TypingContexts {
    private readonly line: (index: number) => DocumentLine;
    private states: TypingContext[] = [initial()];
    private language = '';

    constructor(line: (index: number) => DocumentLine) {
        this.line = line;
    }

    invalidate(line = 0): void {
        this.states.length = Math.min(this.states.length, Math.max(1, line + 1));
    }

    at(line: number, column: number, language: string): TypingContext {
        const id = language.toLowerCase();
        if (this.language !== id) {
            this.language = id;
            this.states = [initial()];
        }
        const rules = rulesOf(id);
        while (this.states.length <= line) {
            const previous = this.states.at(-1)!;
            const source = this.line(this.states.length - 1);
            const next = scan(source.text, source.text.length, previous, rules, source.start);
            // Only PHP and Rust strings run past a line break without a trailing backslash.
            if (next.mode === 'line-comment' || next.mode === 'regex' || (next.mode === 'quote' && !/^(php|rust|rs)$/i.test(id) && !next.escaped)) {
                next.mode = 'code';
                next.quote = undefined;
                next.expression = true;
            }
            next.escaped = false;
            this.states.push(sameState(next, previous) ? previous : next);
        }
        const source = this.line(line);
        return scan(source.text, column, this.states[line], rules, source.start);
    }
}
