import type { LanguageServerKind } from '@ruimte/contracts';
import type { NativeKind } from './native.ts';

/* A kind installed as npm packages, which is every kind but the native ones. */
export type NpmKind = Exclude<LanguageServerKind, NativeKind>;

/*
 * What a server install pins, exactly. The `typescript` kind runs the native server of TypeScript 7.
 * The Vue kind stays on the TypeScript 6 SDK and typescript-language-server, since TypeScript 7 has no
 * plugin API for `@vue/typescript-plugin`. A version moves here and nowhere else, and a kind installed
 * at other versions reads as not installed.
 */
export const LANGUAGE_PACKAGE_VERSIONS = {
    'typescript-language-server': '6.0.1',
    typescript: '6.0.3',
    // The same TypeScript 6 under another name, next to the `typescript` 7 of its kind.
    'typescript-sdk-6': '6.0.3',
    // The `typescript` package at 7, which brings the native server in a package of its platform.
    'typescript-native': '7.0.2',
    '@vue/language-server': '3.3.12',
    '@vue/typescript-plugin': '3.3.12',
    intelephense: '1.18.5',
    // One package holds the CSS, HTML, JSON and ESLint servers, each installed under its own kind.
    'vscode-langservers-extracted': '4.10.0',
    '@tailwindcss/language-server': '0.16.0',
    'yaml-language-server': '1.24.0',
    pyright: '1.1.414',
    'bash-language-server': '5.8.1',
    'dockerfile-language-server-nodejs': '0.15.0'
} as const;

export type LanguagePackage = keyof typeof LANGUAGE_PACKAGE_VERSIONS;

/* The npm package behind a pin, where it is not the pin's own name. */
const NPM_NAMES: Partial<Record<LanguagePackage, string>> = { 'typescript-native': 'typescript', 'typescript-sdk-6': 'typescript-6' };

/* What a pin installs as when the package is an alias of another one. */
const NPM_SPECS: Partial<Record<LanguagePackage, (version: string) => string>> = { 'typescript-sdk-6': (version) => `npm:typescript@${version}` };

/* Vue pairs its server with a TypeScript server that loads the plugin, so its install holds both. */
export const LANGUAGE_KIND_PACKAGES: Record<NpmKind, readonly LanguagePackage[]> = {
    // TypeScript 7 serves the document, and TypeScript 6 behind typescript-language-server answers the code actions 7 lacks.
    typescript: ['typescript-native', 'typescript-language-server', 'typescript-sdk-6'],
    vue: ['typescript-language-server', 'typescript', '@vue/language-server', '@vue/typescript-plugin'],
    php: ['intelephense'],
    css: ['vscode-langservers-extracted'],
    html: ['vscode-langservers-extracted'],
    json: ['vscode-langservers-extracted'],
    yaml: ['yaml-language-server'],
    python: ['pyright'],
    bash: ['bash-language-server'],
    docker: ['dockerfile-language-server-nodejs'],
    eslint: ['vscode-langservers-extracted'],
    tailwind: ['@tailwindcss/language-server']
};

/* The package a kind is named after, whose version a client reads. */
export const LANGUAGE_KIND_MAIN_PACKAGE: Record<NpmKind, LanguagePackage> = {
    typescript: 'typescript-native',
    vue: '@vue/language-server',
    php: 'intelephense',
    css: 'vscode-langservers-extracted',
    html: 'vscode-langservers-extracted',
    json: 'vscode-langservers-extracted',
    yaml: 'yaml-language-server',
    python: 'pyright',
    bash: 'bash-language-server',
    docker: 'dockerfile-language-server-nodejs',
    eslint: 'vscode-langservers-extracted',
    tailwind: '@tailwindcss/language-server'
};

/* The npm packages of a kind with their exact versions, as its `package.json` lists them. */
export function pinnedVersionsOf(kind: NpmKind): Record<string, string> {
    return Object.fromEntries(
        LANGUAGE_KIND_PACKAGES[kind].map((name) => [
            NPM_NAMES[name] ?? name,
            NPM_SPECS[name]?.(LANGUAGE_PACKAGE_VERSIONS[name]) ?? LANGUAGE_PACKAGE_VERSIONS[name]
        ])
    );
}

export function versionOf(kind: NpmKind): string {
    return LANGUAGE_PACKAGE_VERSIONS[LANGUAGE_KIND_MAIN_PACKAGE[kind]];
}
