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

export interface BracketIndex {
    /** Both directions: an opener maps to its closer and the closer back to the opener. */
    pairs: ReadonlyMap<number, number>;
    unmatched: ReadonlySet<number>;
}

interface OpenBracket {
    at: number;
    close: string;
    /** An `${` whose closer resumes the template text. */
    template?: boolean;
}

function skipLine(text: string, at: number): number {
    const end = text.indexOf('\n', at + 1);
    return end < 0 ? text.length : end;
}

function skipComment(text: string, from: number, terminator: string): number {
    const end = text.indexOf(terminator, from);
    return end < 0 ? text.length : end + terminator.length - 1;
}

function skipString(text: string, at: number, quote: string, endsAtLineBreak: boolean): number {
    let cursor = at + 1;
    for (; cursor < text.length; cursor++) {
        if (text[cursor] === '\\') {
            cursor++;
        } else if (text[cursor] === quote || (endsAtLineBreak && /[\r\n]/.test(text[cursor]))) {
            break;
        }
    }
    return cursor;
}

function skipRegex(text: string, at: number): number {
    let inClass = false;
    let cursor = at + 1;
    for (; cursor < text.length; cursor++) {
        const character = text[cursor];
        if (character === '\\') {
            cursor++;
        } else if (character === '[') {
            inClass = true;
        } else if (character === ']') {
            inClass = false;
        } else if ((character === '/' && !inClass) || /[\r\n]/.test(character)) {
            break;
        }
    }
    return cursor;
}

/** Lexical pairing for incomplete code; malformed nesting never produces crossing pairs. */
export function scanBrackets(text: string, language = 'typescript'): BracketIndex {
    const pairs = new Map<number, number>();
    const unmatched = new Set<number>();
    const stack: OpenBracket[] = [];
    const script = isScript(language);
    const hashComments = hasHashComments(language);
    const phpAttributes = isPhp(language);
    const slashComments = hasSlashComments(language);
    const blockComments = hasBlockComments(language);
    const markupComments = hasMarkupComments(language);
    let inTemplate = false;
    let expectsExpression = true;

    for (let at = 0; at < text.length; at++) {
        const char = text[at];
        const next = text[at + 1];

        if (inTemplate) {
            if (char === '\\') {
                at++;
            } else if (char === '`') {
                inTemplate = false;
                expectsExpression = false;
            } else if (char === '$' && next === '{') {
                stack.push({ at: ++at, close: '}', template: true });
                inTemplate = false;
                expectsExpression = true;
            }
            continue;
        }

        if (/\s/.test(char)) {
            continue;
        }

        if (markupComments && text.startsWith('<!--', at)) {
            at = skipComment(text, at + 4, '-->');
        } else if ((slashComments && char === '/' && next === '/') || (hashComments && char === '#' && !(phpAttributes && next === '['))) {
            at = skipLine(text, at);
        } else if (blockComments && char === '/' && next === '*') {
            at = skipComment(text, at + 2, '*/');
        } else if (char === '"' || char === "'") {
            at = skipString(text, at, char, script);
            expectsExpression = false;
        } else if (script && char === '`') {
            inTemplate = true;
        } else if (script && char === '/' && expectsExpression) {
            at = skipRegex(text, at);
            expectsExpression = false;
        } else if (openers[char]) {
            stack.push({ at, close: openers[char] });
            expectsExpression = true;
        } else if (/[)\]}]/.test(char)) {
            const open = stack.at(-1);
            if (open?.close === char) {
                stack.pop();
                pairs.set(open.at, at);
                pairs.set(at, open.at);
                inTemplate = open.template === true;
            } else {
                unmatched.add(at);
                // A mismatched closer keeps a distant opener from claiming it later.
                for (const abandoned of stack.splice(0)) {
                    unmatched.add(abandoned.at);
                }
            }
            expectsExpression = false;
        } else if (isWordCharacter(char)) {
            const start = at;
            while (at + 1 < text.length && isWordCharacter(text[at + 1])) {
                at++;
            }
            expectsExpression = startsExpression(text.slice(start, at + 1));
        } else {
            expectsExpression = startsExpressionAfter(char);
        }
    }

    for (const open of stack) {
        unmatched.add(open.at);
    }
    return { pairs, unmatched };
}
