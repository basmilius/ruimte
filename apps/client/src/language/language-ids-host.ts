import { matchesFilePattern, type LanguageServerStatus } from '@ruimte/contracts';
import { lspLanguageIdOf as sharedLspLanguageIdOf } from '@adecore/editor-react';
export { shikiLanguageOf, shikiLanguageOfPath } from '@adecore/editor-react';

// TODO(Bas): drop once @adecore/editor-react maps `sql` itself (basmilius/adecore#43).
export function lspLanguageIdOf(language: string | undefined): string | null {
    return language === 'sql' ? 'sql' : sharedLspLanguageIdOf(language);
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
