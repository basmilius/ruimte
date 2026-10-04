import type { LanguageServerKind } from '@ruimte/contracts';

/*
 * What a server install pins, exactly. TypeScript stays on the 6 SDK that typescript-language-server
 * 6 drives; TypeScript 7 is another implementation. A version moves here and nowhere else, and a
 * kind installed at other versions reads as not installed.
 */
export const LANGUAGE_PACKAGE_VERSIONS = {
    'typescript-language-server': '6.0.1',
    typescript: '6.0.3',
    '@vue/language-server': '3.3.12',
    '@vue/typescript-plugin': '3.3.12',
    intelephense: '1.18.5'
} as const;

export type LanguagePackage = keyof typeof LANGUAGE_PACKAGE_VERSIONS;

/* Vue pairs its server with a TypeScript server that loads the plugin, so its install holds both. */
export const LANGUAGE_KIND_PACKAGES: Record<LanguageServerKind, readonly LanguagePackage[]> = {
    typescript: ['typescript-language-server', 'typescript'],
    vue: ['typescript-language-server', 'typescript', '@vue/language-server', '@vue/typescript-plugin'],
    php: ['intelephense']
};

/* The package a kind is named after, whose version a client reads. */
export const LANGUAGE_KIND_MAIN_PACKAGE: Record<LanguageServerKind, LanguagePackage> = {
    typescript: 'typescript-language-server',
    vue: '@vue/language-server',
    php: 'intelephense'
};

export function pinnedVersionsOf(kind: LanguageServerKind): Record<string, string> {
    return Object.fromEntries(LANGUAGE_KIND_PACKAGES[kind].map((name) => [name, LANGUAGE_PACKAGE_VERSIONS[name]]));
}

export function versionOf(kind: LanguageServerKind): string {
    return LANGUAGE_PACKAGE_VERSIONS[LANGUAGE_KIND_MAIN_PACKAGE[kind]];
}
