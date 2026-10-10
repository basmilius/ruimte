import { desktop } from '@/desktop/bridge';
import { FALLBACK_LANGUAGE, LANGUAGE_SYSTEM, languageOf, type AppLanguage } from '@/i18n/languages';
import { useSettings } from '@/state/settings';

/*
 * The operating system's languages, in its order. The shell reads them from the system, since
 * Chromium only names the language of the app bundle; a browser has `navigator.languages`.
 */
export function systemLanguages(): readonly string[] {
    const fromShell = desktop()?.systemLanguages;
    if (fromShell !== undefined && fromShell.length > 0) {
        return fromShell;
    }
    if (typeof navigator === 'undefined') {
        return [];
    }
    return navigator.languages ?? (navigator.language ? [navigator.language] : []);
}

/* The language the interface is written in right now: the one a person picked, or the first one the
   system asks for that we speak, or English. */
export function activeLanguage(): AppLanguage {
    const chosen = useSettings.getState().language;
    if (chosen !== LANGUAGE_SYSTEM) {
        return chosen as AppLanguage;
    }
    return languageOf(systemLanguages()) ?? FALLBACK_LANGUAGE;
}
