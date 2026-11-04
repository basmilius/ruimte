import { AGENTS_LOCALES, AGENTS_NAMESPACES } from '@adecore/agents-react/locales';
import { CHARTS_NAMESPACE, CHARTS_RESOURCES } from '@adecore/charts';
import { UI_NAMESPACE } from '@adecore/ui';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { forgetMemoizedWords } from '@/compiler-runtime';
import { desktop } from '@/desktop/bridge';
import { activeLanguage } from '@/i18n/active';
import { APP_LANGUAGES, FALLBACK_LANGUAGE, type AppLanguage } from '@/i18n/languages';
import { NAMESPACES } from '@/i18n/namespaces';
import { useSettings } from '@/state/settings';

// Bundle namespaces together so the first render waits on one request per language.
const bundles = {
    en: () => import('./bundles/en'),
    nl: () => import('./bundles/nl')
};

const editorBundles = {
    en: () => import('@adecore/editor-react/locales/en.json'),
    nl: () => import('@adecore/editor-react/locales/nl.json')
};

const loaded = new Map<AppLanguage, Promise<void>>();

async function load(language: AppLanguage): Promise<void> {
    const [editor, resources, agents] = await Promise.all([editorBundles[language](), bundles[language](), AGENTS_LOCALES[language]?.()]);
    i18next.addResourceBundle(language, 'editor', editor.default, true, true);
    const charts = CHARTS_RESOURCES[language];
    for (const [namespace, resource] of Object.entries({ ...resources.default, ...agents, ...(charts ? { [CHARTS_NAMESPACE]: charts } : {}) })) {
        i18next.addResourceBundle(language, namespace, resource, true, true);
    }
}

// A load that failed is forgotten, so the next ask tries again.
function loadOnce(language: AppLanguage): Promise<void> {
    let pending = loaded.get(language);
    if (pending === undefined) {
        pending = load(language).catch((error: unknown) => {
            loaded.delete(language);
            throw error;
        });
        loaded.set(language, pending);
    }
    return pending;
}

/*
 * English is loaded beside any other language, never instead of it: a key that has not been
 * translated yet reads as English rather than as its own name.
 */
async function ensure(language: AppLanguage): Promise<void> {
    await Promise.all([loadOnce(language), loadOnce(FALLBACK_LANGUAGE)]);
}

/* What a screen reader announces in and what a spell checker checks against. `index.html` ships
   with English on it, so it is only ever wrong between the first byte and this line. */
function markDocument(language: string): void {
    desktop()?.setLanguage?.(language);
    if (typeof document !== 'undefined') {
        document.documentElement.lang = language;
    }
}

/* Called once, before the first render, so nothing is ever drawn in a language a person did not ask
   for and then swapped under them. */
export async function initI18n(): Promise<void> {
    const language = activeLanguage();
    // Ahead of every `useTranslation`, so the redraw a change causes already finds the caches emptied.
    i18next.on('languageChanged', forgetMemoizedWords);
    await i18next.use(initReactI18next).init({
        lng: language,
        fallbackLng: FALLBACK_LANGUAGE,
        supportedLngs: [...APP_LANGUAGES],
        defaultNS: 'common',
        ns: [...NAMESPACES, UI_NAMESPACE, CHARTS_NAMESPACE, ...AGENTS_NAMESPACES],
        // React escapes what it draws, so escaping here would show `&#39;` where an apostrophe was.
        interpolation: { escapeValue: false },
        resources: {}
    });
    await ensure(language);
    markDocument(language);
}

/* Reads the setting back and puts the interface in that language, loading its words first. */
async function applyLanguage(): Promise<void> {
    const language = activeLanguage();
    if (i18next.language === language) {
        return;
    }
    await ensure(language);
    await i18next.changeLanguage(language);
    markDocument(language);
}

/*
 * What redraws the interface when only the region changed. The words are the same, but every date
 * and every number in them is not, and `useTranslation` is the one subscription every surface that
 * writes one already has.
 */
function redrawForRegion(): void {
    i18next.emit('languageChanged', i18next.language);
}

/*
 * The two settings that change what a screen reads like, and the only pair that has to redraw the
 * whole interface rather than one pane. They sit together because the region follows the language
 * unless a person said otherwise, so picking a language moves both.
 */
export async function chooseLanguage(choice: string): Promise<void> {
    useSettings.getState().update({ language: choice });
    await applyLanguage();
    redrawForRegion();
}

export function chooseRegion(choice: string): void {
    useSettings.getState().update({ formatRegion: choice });
    redrawForRegion();
}
