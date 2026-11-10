import { lspLanguageIdOf } from '@adecore/lsp';
import { matchesFilePattern, type LanguageServerStatus } from '@ruimte/contracts';

/* The files of a native server that no highlighter id names: Zig's package manifests. */
const NATIVE_BY_EXTENSION: Record<string, string> = { zon: 'zon' };

/* The files gopls tells apart by the language id of the document, which the machine reads as no language. */
const NATIVE_BY_NAME: Record<string, string> = { 'go.mod': 'go.mod', 'go.work': 'go.work' };

/*
 * The LSP language id a file opens with when a server here serves it, or null. The machine decides which
 * server takes the document, so a language left out here is a file that never opens on the machine.
 */
export function lspLanguageIdFor(language: string | undefined, path: string): string | null {
    const known = lspLanguageIdOf(language);

    if (known !== null) {
        return known;
    }

    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    const dot = name.lastIndexOf('.');

    return NATIVE_BY_NAME[name] ?? (dot > 0 ? (NATIVE_BY_EXTENSION[name.slice(dot + 1)] ?? null) : null);
}

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
