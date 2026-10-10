/* A language is a whole translation or it is not on this list: a missing half lands mid-sentence. */
export const LANGUAGE_SYSTEM = 'system';

export const APP_LANGUAGES = ['en', 'nl'] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

/* Every language names itself, the way an operating system lists them, so a person who opened this
   by accident can find the way back. */
export const LANGUAGE_LABELS: Record<AppLanguage, string> = { en: 'English', nl: 'Nederlands' };

export const FALLBACK_LANGUAGE: AppLanguage = 'en';

export function isAppLanguage(value: unknown): value is AppLanguage {
    return APP_LANGUAGES.some((language) => language === value);
}

/* A stored language, or the system for anything this version does not speak. */
export function languageFrom(stored: unknown): string {
    return isAppLanguage(stored) ? stored : LANGUAGE_SYSTEM;
}

/* Only the language is read, never the country: Dutch in Belgium wants Dutch, and the country is the region's business. */
export function languageOf(preferred: readonly string[]): AppLanguage | null {
    for (const tag of preferred) {
        const base = tag.toLowerCase().split(/[-_]/)[0];
        const known = APP_LANGUAGES.find((language) => language === base);
        if (known !== undefined) {
            return known;
        }
    }
    return null;
}
