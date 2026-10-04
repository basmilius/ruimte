import type { LanguageServerKind } from '@ruimte/contracts';

/* The highlighter ids `fs.read` answers with, by the id LSP names the same language. */
const LSP_IDS: Record<string, string> = {
    typescript: 'typescript',
    tsx: 'typescriptreact',
    javascript: 'javascript',
    jsx: 'javascriptreact',
    vue: 'vue',
    php: 'php'
};

const SERVER_KINDS: Record<string, LanguageServerKind> = {
    typescript: 'typescript',
    typescriptreact: 'typescript',
    javascript: 'typescript',
    javascriptreact: 'typescript',
    vue: 'vue',
    php: 'php'
};

/* The LSP language id of a file, or null when no language server here knows its language. */
export function lspLanguageIdOf(language: string | undefined): string | null {
    return language === undefined ? null : (LSP_IDS[language] ?? null);
}

/*
 * The kind a status chip reports for a language. A project that uses Vue serves its scripts through
 * the Vue kind, which the daemon decides, so the chip asks the statuses it has and not this alone.
 */
export function serverKindOf(lspLanguageId: string): LanguageServerKind | null {
    return SERVER_KINDS[lspLanguageId] ?? null;
}
