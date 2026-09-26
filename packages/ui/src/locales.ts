type Bundle = { default: Record<string, unknown> };

/* The words of this package live in a namespace of their own, which the app adds to its i18next beside its own namespaces. */
export const UI_NAMESPACE = 'ui';

/* One loader per language, so a bundler splits them and a window only downloads the language it shows. */
export const UI_LOCALES: Record<string, () => Promise<Bundle>> = {
    en: () => import('./locales/en.json'),
    nl: () => import('./locales/nl.json')
};
