import { matchesFilePattern, type LanguageServerKind, type LanguageServerStatus } from '@ruimte/contracts';
export { lspLanguageIdOf, shikiLanguageOf, shikiLanguageOfPath } from '@adecore/editor-react';

const SERVER_KINDS: Record<string, LanguageServerKind> = {
    typescript: 'typescript',
    typescriptreact: 'typescript',
    javascript: 'typescript',
    javascriptreact: 'typescript',
    vue: 'vue',
    php: 'php-native',
    css: 'css',
    scss: 'css',
    less: 'css',
    html: 'html',
    json: 'json',
    jsonc: 'json',
    yaml: 'yaml',
    python: 'python',
    shellscript: 'bash',
    dockerfile: 'docker',
    sql: 'sql-native'
};

export function customLanguageIdOf(statuses: readonly LanguageServerStatus[], language: string | undefined, storedPath: string): string | null {
    for (const status of statuses) {
        if (status.languages === undefined || status.patterns === undefined) {
            continue;
        }
        if (language !== undefined && status.languages.includes(language.toLowerCase())) {
            return language.toLowerCase();
        }
        if (status.patterns.some((pattern) => matchesFilePattern(pattern, storedPath))) {
            return language?.toLowerCase() ?? 'plaintext';
        }
    }
    return null;
}

export function serverKindOf(lspLanguageId: string): LanguageServerKind | null {
    return SERVER_KINDS[lspLanguageId] ?? null;
}
