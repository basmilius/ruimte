import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { UI_LOCALES, UI_NAMESPACE } from '@ruimte/ui/locales';
import { activeLanguage } from '@/i18n/active';
import { FALLBACK_LANGUAGE, type AppLanguage } from '@/i18n/languages';
import { NAMESPACES } from '@/i18n/namespaces';
import { useSettings } from '@/state/settings';

/* Every translation file, by its path, loaded only when a language is actually asked for. Vite
   splits these into a chunk per language, so a Dutch window never downloads the English words. */
const bundles = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json');

const load = async (language: AppLanguage): Promise<void> => {
    const prefix = `./locales/${language}/`;
    await Promise.all(
        Object.entries(bundles)
            .filter(([path]) => path.startsWith(prefix))
            .map(async ([path, open]) => {
                const namespace = path.slice(prefix.length, -'.json'.length);
                const resource = await open();
                i18next.addResourceBundle(language, namespace, resource.default, true, true);
            })
    );
    const ui = UI_LOCALES[language];
    if (ui) {
        i18next.addResourceBundle(language, UI_NAMESPACE, (await ui()).default, true, true);
    }
};

/*
 * English is loaded beside any other language, never instead of it: a key that has not been
 * translated yet reads as English rather than as its own name. It is the one language that is
 * always in memory, which is what makes a missing word a small flaw and not a broken screen.
 */
const ensure = async (language: AppLanguage): Promise<void> => {
    await load(language);
    if (language !== FALLBACK_LANGUAGE) {
        await load(FALLBACK_LANGUAGE);
    }
};

/* What a screen reader announces in and what a spell checker checks against. `index.html` ships
   with English on it, so it is only ever wrong between the first byte and this line. */
const markDocument = (language: string): void => {
    if (typeof document !== 'undefined') {
        document.documentElement.lang = language;
    }
};

/* Called once, before the first render, so nothing is ever drawn in a language a person did not ask
   for and then swapped under them. */
export const initI18n = async (): Promise<void> => {
    const language = activeLanguage();
    await i18next.use(initReactI18next).init({
        lng: language,
        fallbackLng: FALLBACK_LANGUAGE,
        supportedLngs: ['en', 'nl'],
        defaultNS: 'common',
        ns: [...NAMESPACES, UI_NAMESPACE],
        // React escapes what it draws, so escaping here would show `&#39;` where an apostrophe was.
        interpolation: { escapeValue: false },
        resources: {}
    });
    await ensure(language);
    markDocument(language);
};

/* Reads the setting back and puts the interface in that language, loading its words first. */
export const applyLanguage = async (): Promise<void> => {
    const language = activeLanguage();
    if (i18next.language === language) {
        return;
    }
    await ensure(language);
    await i18next.changeLanguage(language);
    markDocument(language);
};

/*
 * What redraws the interface when only the region changed. The words are the same, but every date
 * and every number in them is not, and `useTranslation` is the one subscription every surface that
 * writes one already has.
 */
export const redrawForRegion = (): void => {
    i18next.emit('languageChanged', i18next.language);
};

/*
 * The two settings that change what a screen reads like, and the only pair that has to redraw the
 * whole interface rather than one pane. They sit together because the region follows the language
 * unless a person said otherwise, so picking a language moves both.
 */
export const chooseLanguage = async (choice: string): Promise<void> => {
    useSettings.getState().update({ language: choice });
    await applyLanguage();
    redrawForRegion();
};

export const chooseRegion = (choice: string): void => {
    useSettings.getState().update({ formatRegion: choice });
    redrawForRegion();
};
