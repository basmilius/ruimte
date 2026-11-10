import { SCRIPT_LANGUAGE_IDS } from '@adecore/lsp';
import { boundLines, UNTRUSTED_CODE } from './editor-assist-text.ts';

/* How many names the model is asked for; the editor shows the first few it can use. */
export const NAMES_ASKED = 5;

const NAMES_SAMPLE_LINES = 8;
const NAMES_LINE_MAX = 160;
const NAMES_CONTEXT_MAX = 700;
const NAMES_KIND = /^[a-z]+(?: [a-z]+)?$/;

export const NAMES_INSTRUCTIONS = [
    'You suggest names for a symbol in source code, from how it is declared and used.',
    `Reply with exactly ${NAMES_ASKED} different names, one per line, best first.`,
    'Each name fits the kind of symbol the request names: a function or method says what it does, a class, type or variable what it holds or is.',
    'Each name is a single identifier in the naming style of the code around it. No numbering, no punctuation, no explanation, no code blocks.',
    UNTRUSTED_CODE
].join(' ');

export interface NamesInput {
    readonly language: string;
    readonly name: string;
    /* What the name belongs to (`function`, `class`), when the editor knows it. */
    readonly kind?: string;
    /* The lines around the one the rename started on. */
    readonly context: string;
    /* Lines the name appears on, in file order, the declaration first when the servers list it. */
    readonly uses: readonly string[];
}

export function namesPrompt(input: NamesInput): string {
    const uses = input.uses.slice(0, NAMES_SAMPLE_LINES).map((line) => line.trim().slice(0, NAMES_LINE_MAX));
    // The kind is written into the request itself, so only a plain word from an outline gets there.
    const kind = input.kind !== undefined && NAMES_KIND.test(input.kind) ? input.kind : null;
    return [
        `Suggest new names for the ${kind ?? 'symbol'} ${input.name}.`,
        `Language: ${input.language}`,
        ...(kind === null ? [] : [`Kind: ${kind}`]),
        `Current name: ${input.name}`,
        '',
        'Code around it:',
        boundLines(input.context, NAMES_CONTEXT_MAX),
        '',
        'Lines that use it:',
        ...uses
    ].join('\n');
}

/* Words that are a keyword in one of the common languages, so a name can never be one of them. */
const RESERVED = new Set(
    (
        'abstract and await break case catch class const continue debugger def default del delete do echo elif else enum except export extends false False ' +
        'final finally fn for foreach func function global if implements import in instanceof interface is lambda let nil None not null or package pass ' +
        'private protected public raise return self static struct super switch this throw true True try typeof undefined var void while with yield'
    ).split(' ')
);

/* Languages whose names may hold a hyphen, which are mostly the ones that name classes and properties in a style sheet or markup. */
const HYPHENATED = new Set(['css', 'scss', 'less', 'sass', 'html', 'vue', 'svelte', 'astro', 'xml', 'yaml', 'json', 'jsonc', 'toml', 'tailwindcss']);

/* Languages whose names may hold a dollar sign. */
const DOLLAR_NAMED = new Set<string>(SCRIPT_LANGUAGE_IDS);

const PLAIN_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const DOLLAR_NAME = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const HYPHEN_NAME = /^[\p{L}_][\p{L}\p{N}_-]*$/u;

/* Whether a text is a name the language accepts for a symbol, going by the editor's language id. */
export function isValidName(name: string, languageId: string): boolean {
    if (name === '' || name.length > 64 || RESERVED.has(name)) {
        return false;
    }
    if (HYPHENATED.has(languageId)) {
        return HYPHEN_NAME.test(name);
    }
    return (DOLLAR_NAMED.has(languageId) ? DOLLAR_NAME : PLAIN_NAME).test(name);
}

/* A leading list marker, quote or backtick the model puts in front of a name, and what follows the name on the line. */
const MARKER = /^\s*(?:[-*•]|\d+[.)])?\s*[`'"]?/u;

/* A name alone on its line, or followed by an explanation after a colon, a dash or a bracket; a line of several plain words is a sentence. */
const NAME_LINE = /^([^\s`'",:;()]+)[`'"]?\s*(?:[:(\u2013-].*)?$/u;

/*
 * The names in the model's answer, one per line: the first word of each line, without list markers or
 * quotes, kept only when the language accepts it, in the order given, never the name the symbol has and
 * never twice. A PHP variable keeps the dollar sign it has, which the model leaves out.
 */
export function parseNames(output: string, current: string, languageId: string, limit: number): string[] {
    const sigil = languageId === 'php' && current.startsWith('$') ? '$' : '';
    const bare = sigil === '' ? current : current.slice(1);
    const names: string[] = [];
    for (const line of output.split(/\r?\n/)) {
        const word = NAME_LINE.exec(line.replace(MARKER, ''))?.[1] ?? '';
        const cleaned = sigil !== '' && word.startsWith('$') ? word.slice(1) : word;
        if (cleaned === bare || names.includes(`${sigil}${cleaned}`) || !isValidName(cleaned, languageId)) {
            continue;
        }
        names.push(`${sigil}${cleaned}`);
        if (names.length === limit) {
            break;
        }
    }
    return names;
}
