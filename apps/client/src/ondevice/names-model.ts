/* What the model is given to name a symbol, and what comes back, as names a language would accept. */

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
    return languageId === 'typescript' ||
        languageId === 'javascript' ||
        languageId === 'typescriptreact' ||
        languageId === 'javascriptreact' ||
        languageId === 'vue'
        ? DOLLAR_NAME.test(name)
        : PLAIN_NAME.test(name);
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
