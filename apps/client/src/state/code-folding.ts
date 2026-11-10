import type { FoldRole } from '@adecore/editor';
import { switchesFrom } from '@/state/stored-json';

/* What folds by itself when a file opens, one switch per kind of fold. The names before a language are the ones that language adds. */
export interface CodeFolding {
    fileHeader: boolean;
    imports: boolean;
    docComments: boolean;
    /* The body of a function or method, in every language but PHP, which has its own below. */
    methodBodies: boolean;
    customRegions: boolean;
    scriptObjectLiterals: boolean;
    scriptArrayLiterals: boolean;
    scriptXmlLiterals: boolean;
    phpTags: boolean;
    phpHeredocs: boolean;
    phpFunctionBodies: boolean;
    phpMethodBodies: boolean;
    phpClassBodies: boolean;
    phpAttributes: boolean;
    markupTags: boolean;
    markdownFrontMatter: boolean;
    markdownCodeFences: boolean;
    markdownTables: boolean;
}

/* The platform's own defaults: the file header and the imports fold, and the rest waits for a person to ask. Markdown front matter folds as well. */
export const DEFAULT_CODE_FOLDING: CodeFolding = {
    fileHeader: true,
    imports: true,
    docComments: false,
    methodBodies: false,
    customRegions: false,
    scriptObjectLiterals: false,
    scriptArrayLiterals: false,
    scriptXmlLiterals: false,
    phpTags: false,
    phpHeredocs: false,
    phpFunctionBodies: false,
    phpMethodBodies: false,
    phpClassBodies: false,
    phpAttributes: false,
    markupTags: false,
    markdownFrontMatter: true,
    markdownCodeFences: false,
    markdownTables: false
};

export function codeFoldingFrom(stored: unknown): CodeFolding {
    return switchesFrom(stored, DEFAULT_CODE_FOLDING);
}

const SCRIPTS = /^(typescript|javascript|typescriptreact|javascriptreact|tsx|jsx|ts|js|mjs|cjs|mts|cts)$/;
const MARKUP = /^(html|xml|svg|xsl|vue|svelte|astro)$/;
const MARKDOWN = /^(markdown|md|mdx)$/;

export function foldRolesFor(language: string | undefined, folding: CodeFolding): FoldRole[] {
    const id = language?.toLowerCase() ?? '';
    const php = id === 'php';
    const script = SCRIPTS.test(id);
    const markdown = MARKDOWN.test(id);
    const wanted: [boolean, FoldRole][] = [
        [folding.fileHeader, 'file-header'],
        [folding.imports, 'imports'],
        [folding.docComments, 'doc-comment'],
        [folding.customRegions, 'region'],
        [!php && folding.methodBodies, 'function-body'],
        [!php && folding.methodBodies, 'method-body'],
        [script && folding.scriptObjectLiterals, 'object-literal'],
        [script && folding.scriptArrayLiterals, 'array-literal'],
        [script && folding.scriptXmlLiterals, 'tag'],
        [php && folding.phpTags, 'php-tag'],
        [php && folding.phpHeredocs, 'heredoc'],
        [php && folding.phpFunctionBodies, 'function-body'],
        [php && folding.phpMethodBodies, 'method-body'],
        [php && folding.phpClassBodies, 'class-body'],
        [php && folding.phpAttributes, 'attribute'],
        [MARKUP.test(id) && folding.markupTags, 'tag'],
        [markdown && folding.markdownFrontMatter, 'front-matter'],
        [markdown && folding.markdownCodeFences, 'code-fence'],
        [markdown && folding.markdownTables, 'table']
    ];
    return wanted.filter(([on]) => on).map(([, role]) => role);
}
