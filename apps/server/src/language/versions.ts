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
    intelephense: '1.18.5',
    // One package holds the CSS, HTML, JSON and ESLint servers, each installed under its own kind.
    'vscode-langservers-extracted': '4.10.0',
    'yaml-language-server': '1.24.0',
    pyright: '1.1.414',
    'bash-language-server': '5.8.1',
    'dockerfile-language-server-nodejs': '0.15.0'
} as const;

export type LanguagePackage = keyof typeof LANGUAGE_PACKAGE_VERSIONS;

/* Vue pairs its server with a TypeScript server that loads the plugin, so its install holds both. */
export const LANGUAGE_KIND_PACKAGES: Record<LanguageServerKind, readonly LanguagePackage[]> = {
    typescript: ['typescript-language-server', 'typescript'],
    vue: ['typescript-language-server', 'typescript', '@vue/language-server', '@vue/typescript-plugin'],
    php: ['intelephense'],
    css: ['vscode-langservers-extracted'],
    html: ['vscode-langservers-extracted'],
    json: ['vscode-langservers-extracted'],
    yaml: ['yaml-language-server'],
    python: ['pyright'],
    bash: ['bash-language-server'],
    docker: ['dockerfile-language-server-nodejs']
};

/* The package a kind is named after, whose version a client reads. */
export const LANGUAGE_KIND_MAIN_PACKAGE: Record<LanguageServerKind, LanguagePackage> = {
    typescript: 'typescript-language-server',
    vue: '@vue/language-server',
    php: 'intelephense',
    css: 'vscode-langservers-extracted',
    html: 'vscode-langservers-extracted',
    json: 'vscode-langservers-extracted',
    yaml: 'yaml-language-server',
    python: 'pyright',
    bash: 'bash-language-server',
    docker: 'dockerfile-language-server-nodejs'
};

export function pinnedVersionsOf(kind: LanguageServerKind): Record<string, string> {
    return Object.fromEntries(LANGUAGE_KIND_PACKAGES[kind].map((name) => [name, LANGUAGE_PACKAGE_VERSIONS[name]]));
}

export function versionOf(kind: LanguageServerKind): string {
    return LANGUAGE_PACKAGE_VERSIONS[LANGUAGE_KIND_MAIN_PACKAGE[kind]];
}
