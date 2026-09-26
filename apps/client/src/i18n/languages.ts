/*
 * The languages the interface is written in. A language is a whole translation or it is not on this
 * list: half a language reads worse than a language nobody speaks, since the half that is missing
 * lands in the middle of a sentence.
 */
export const LANGUAGE_SYSTEM = 'system';

export const APP_LANGUAGES = ['en', 'nl'] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

/* Every language names itself, the way an operating system lists them, so a person who opened this
   by accident can find the way back. */
export const LANGUAGE_LABELS: Record<AppLanguage, string> = { en: 'English', nl: 'Nederlands' };

export const FALLBACK_LANGUAGE: AppLanguage = 'en';

export const isAppLanguage = (value: unknown): value is AppLanguage => APP_LANGUAGES.some((language) => language === value);

/* A stored language, or the system for anything this version does not speak. */
export const languageFrom = (stored: unknown): string => (isAppLanguage(stored) ? stored : LANGUAGE_SYSTEM);

/*
 * Which of our languages a list of system languages asks for. Only the language is read, never the
 * country: someone whose Mac is set to Dutch in Belgium wants Dutch, and the country is the region's
 * business, not this one's.
 */
export const languageOf = (preferred: readonly string[]): AppLanguage | null => {
    for (const tag of preferred) {
        const base = tag.toLowerCase().split(/[-_]/)[0];
        const known = APP_LANGUAGES.find((language) => language === base);
        if (known !== undefined) {
            return known;
        }
    }
    return null;
};
