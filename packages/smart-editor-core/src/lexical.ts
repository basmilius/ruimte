export const openers: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

/* Words after which a `/` starts a regex and a `{` an object or a block, not a division or a statement end. */
const expressionWords = /^(return|throw|case|yield|await|new|delete|typeof|void|in|of|instanceof)$/;

/* Whether a `#` at this index stands where a word would start, after whitespace, a separator or an opener. */
export function startsWord(text: string, at: number): boolean {
    return at === 0 || /[\s;|&(]/.test(text[at - 1]!);
}

/*
 * What a language's comments and braces look like to the lexer. The lists are positive: a language
 * nobody listed has no comment syntax, so a `/*` in a YAML value or a `#` in shell never reads as
 * the wrong comment for the rest of the file. The ids are the ones Shiki gives the editor.
 */
interface LanguageRules {
    slash: boolean;
    /* `any` is a comment wherever it stands, `boundary` only at the start of a word, as in shell and YAML. */
    hash: false | 'any' | 'boundary';
    dash: boolean;
    block: boolean;
    markup: boolean;
    /* Blocks are in braces, so a statement may be left open and a `case` label opens a block. */
    braced: boolean;
}

const NO_RULES: LanguageRules = { slash: false, hash: false, dash: false, block: false, markup: false, braced: false };
const languageRules = new Map<string, LanguageRules>();

function register(ids: string, rules: Partial<LanguageRules>): void {
    for (const id of ids.split(' ')) {
        languageRules.set(id, { ...NO_RULES, ...rules });
    }
}

register(
    'typescript javascript typescriptreact javascriptreact tsx jsx ts js mjs cjs mts cts java c cpp c++ csharp cs go rust rs swift kotlin kt scala dart zig groq prisma astro svelte objective-c objc glsl hlsl proto protobuf scss less jsonc json5',
    { slash: true, block: true, braced: true }
);
register('php', { slash: true, hash: 'any', block: true, braced: true });
register('vue', { slash: true, block: true, markup: true, braced: true });
register('hcl terraform', { slash: true, hash: 'any', block: true, braced: true });
register('css', { block: true });
register('html xml svg xsl markdown md mdx', { markup: true });
register('python py toml ruby rb dotenv ignore nix powershell ps1 properties julia jl elixir ex exs coffeescript coffee', { hash: 'any' });
register('shellscript shell sh bash zsh fish yaml yml make makefile docker dockerfile cmake', { hash: 'boundary' });
register('perl r graphql', { hash: 'any', braced: true });
register('sql', { dash: true, block: true });
register('lua haskell hs', { dash: true });

function rulesOf(language: string): LanguageRules {
    return languageRules.get(language.toLowerCase()) ?? NO_RULES;
}

export function isScript(language: string): boolean {
    return /^(typescript|javascript|typescriptreact|javascriptreact|tsx|jsx|ts|js|vue)$/i.test(language);
}

export function isPhp(language: string): boolean {
    return /^php$/i.test(language);
}

export function hasHashComments(language: string): boolean {
    return rulesOf(language).hash !== false;
}

/* Whether a `#` only starts a comment at the start of a word, which keeps `$#` and `${#list}` in shell code. */
export function hashNeedsWordStart(language: string): boolean {
    return rulesOf(language).hash === 'boundary';
}

export function hasDashComments(language: string): boolean {
    return rulesOf(language).dash;
}

export function hasBlockComments(language: string): boolean {
    return rulesOf(language).block;
}

export function hasSlashComments(language: string): boolean {
    return rulesOf(language).slash;
}

export function hasMarkupComments(language: string): boolean {
    return rulesOf(language).markup;
}

/* Languages whose blocks are in braces: where a statement can be left open and a `case` label opens a block. */
export function isBraced(language: string): boolean {
    return rulesOf(language).braced;
}

/* Languages whose indentation follows their brackets, which Auto-indent Lines can work out. */
export function indentsByBrackets(language: string): boolean {
    return (isBraced(language) && !/^(svelte|astro)$/i.test(language)) || /^css$/i.test(language);
}

export function hasSmartSemicolon(language: string): boolean {
    return /^(typescript|javascript|typescriptreact|javascriptreact|tsx|jsx|ts|js|php)$/i.test(language);
}

export function isWordCharacter(character: string): boolean {
    return /[\p{L}\p{N}_$]/u.test(character);
}

export function startsExpression(word: string): boolean {
    return expressionWords.test(word);
}

/* Whether what follows a punctuation character is an expression, so a `/` there is a regex. */
export function startsExpressionAfter(character: string): boolean {
    return /[=,:;!?+\-*%&|^~<>]/.test(character);
}
