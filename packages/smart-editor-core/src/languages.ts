export interface BlockComment {
    open: string;
    close: string;
}

/* Either marker can be missing: CSS has no line comments and Python no block comments. */
export interface CommentSyntax {
    line: string | null;
    block: BlockComment | null;
}

/* The part of a Vue single file component a line sits in. */
export type VueRegion = 'template' | 'script' | 'style';

const slashStar: BlockComment = { open: '/*', close: '*/' };
const html: BlockComment = { open: '<!--', close: '-->' };

const cLike: CommentSyntax = { line: '//', block: slashStar };
const hash: CommentSyntax = { line: '#', block: null };
const markup: CommentSyntax = { line: null, block: html };

const syntaxes = new Map<string, CommentSyntax>();

function register(ids: string, syntax: CommentSyntax): void {
    for (const id of ids.split(' ')) {
        syntaxes.set(id, syntax);
    }
}

register(
    'typescript javascript typescriptreact javascriptreact tsx jsx ts js mjs cjs mts cts java c cpp csharp cs go rust rs swift kotlin scala dart php scss less zig groq json jsonc json5 prisma astro svelte',
    cLike
);
register('css', { line: null, block: slashStar });
register('html xml svg xsl markdown md mdx vue', markup);
register(
    'python py yaml yml shellscript shell sh bash zsh fish toml ruby rb perl r make makefile docker dockerfile dotenv ignore nix graphql powershell ps1 properties',
    hash
);
register('ini', { line: ';', block: null });
register('sql', { line: '--', block: slashStar });
register('lua', { line: '--', block: { open: '--[[', close: ']]' } });
register('haskell hs', { line: '--', block: { open: '{-', close: '-}' } });
register('plaintext text txt log', { line: null, block: null });

/* An id nothing knows is read as C-like, as the rest of the core does. */
export function commentSyntax(language: string, region?: VueRegion | null): CommentSyntax {
    const id = language.toLowerCase();
    if (id === 'vue') {
        if (region === 'script') {
            return cLike;
        }
        return region === 'style' ? { line: null, block: slashStar } : markup;
    }
    return syntaxes.get(id) ?? cLike;
}

/* Plain text has no structure to pair, indent or comment. */
export function isPlainText(language: string): boolean {
    return /^(plaintext|text|txt|log)$/i.test(language);
}

/* The region of a `.vue` file a line is in, from the top-level tags above it. */
export function vueRegionAt(lineText: (line: number) => string, line: number): VueRegion | null {
    let region: VueRegion | null = null;
    for (let index = 0; index <= line; index++) {
        const text = lineText(index);
        const open = /^<(template|script|style)\b/.exec(text);
        if (open) {
            region = open[1] as VueRegion;
        } else if (/^<\/(template|script|style)\s*>/.test(text) && index < line) {
            region = null;
        }
    }
    return region;
}
