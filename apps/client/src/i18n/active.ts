import { desktop } from '@/desktop/bridge';
import { FALLBACK_LANGUAGE, LANGUAGE_SYSTEM, languageOf, type AppLanguage } from '@/i18n/languages';
import { useSettings } from '@/state/settings';

/*
 * Which languages the operating system was asked for, in the order it prefers them. The shell reads
 * them from the system rather than from Chromium, which only ever names the language of the app
 * bundle. A browser has `navigator.languages`, which is the same list by another name.
 */
export const systemLanguages = (): readonly string[] => {
    const fromShell = desktop()?.systemLanguages;
    if (fromShell !== undefined && fromShell.length > 0) {
        return fromShell;
    }
    if (typeof navigator === 'undefined') {
        return [];
    }
    return navigator.languages ?? (navigator.language ? [navigator.language] : []);
};

/* The language the interface is written in right now: the one a person picked, or the first one the
   system asks for that we speak, or English. */
export const activeLanguage = (): AppLanguage => {
    const chosen = useSettings.getState().language;
    if (chosen !== LANGUAGE_SYSTEM) {
        return chosen as AppLanguage;
    }
    return languageOf(systemLanguages()) ?? FALLBACK_LANGUAGE;
};
