import { describe, expect, it } from 'bun:test';
import { KIND_PROFILES, kindForLanguage, lspLanguageId, resolveTypescriptLib, usesVue } from './profiles.ts';
import { LANGUAGE_KIND_PACKAGES, LANGUAGE_PACKAGE_VERSIONS, pinnedVersionsOf, versionOf } from './versions.ts';

const context = { installDirectory: '/home/.ruimte/language-servers/vue', projectFolder: '/work/app', typescriptLib: '/work/app/node_modules/typescript/lib' };

describe('server profiles', () => {
    it('routes a language to the kind that serves it', () => {
        expect(kindForLanguage('typescript')).toBe('typescript');
        expect(kindForLanguage('tsx')).toBe('typescript');
        expect(kindForLanguage('javascriptreact')).toBe('typescript');
        expect(kindForLanguage('vue')).toBe('vue');
        expect(kindForLanguage('php')).toBe('php');
        expect(kindForLanguage('rust')).toBeNull();
        expect(lspLanguageId('tsx')).toBe('typescriptreact');
        expect(lspLanguageId('php')).toBe('php');
    });

    it('drives tsserver with the SDK it is given, the inlay hint preferences on, and no typings fetch', () => {
        const [typescript] = KIND_PROFILES.typescript.components;
        expect(typescript.initializationOptions(context)).toEqual({
            hostInfo: 'ruimte',
            disableAutomaticTypingAcquisition: true,
            tsserver: { path: '/work/app/node_modules/typescript/lib/tsserver.js', useSyntaxServer: 'never' },
            preferences: {
                includeInlayParameterNameHints: 'all',
                includeInlayVariableTypeHints: true,
                includeInlayFunctionLikeReturnTypeHints: true,
                includeInlayFunctionParameterTypeHints: true
            }
        });
        expect(typescript.args(context)).toEqual(['--stdio']);
    });

    it('pairs Vue with a TypeScript server that loads the plugin, started first', () => {
        const [typescript, vue] = KIND_PROFILES.vue.components;
        expect(typescript.name).toBe('typescript');
        expect(vue.name).toBe('vue');
        expect(typescript.initializationOptions(context)).toMatchObject({
            plugins: [{ name: '@vue/typescript-plugin', location: '/home/.ruimte/language-servers/vue/node_modules', languages: ['vue'] }]
        });
        expect(vue.args(context)).toEqual(['--stdio', '--tsdk=/work/app/node_modules/typescript/lib']);
    });

    it('has the one TypeScript server of a Vue project serve the scripts as well as the Vue files', () => {
        const [typescript, vue] = KIND_PROFILES.vue.components;
        expect(typescript.languages).toEqual(['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'vue']);
        expect(vue.languages).toEqual(['vue']);
    });

    it('reads Vue off a package.json, in any kind of dependency, and nothing off one that does not name it', () => {
        expect(usesVue(JSON.stringify({ dependencies: { vue: '^3.5.0' } }))).toBe(true);
        expect(usesVue(JSON.stringify({ devDependencies: { '@vitejs/plugin-vue': '^5' } }))).toBe(true);
        expect(usesVue(JSON.stringify({ dependencies: { nuxt: '^3' } }))).toBe(true);
        expect(usesVue(JSON.stringify({ dependencies: { react: '^19', 'vuex-like': '1' } }))).toBe(false);
        expect(usesVue('not json')).toBe(false);
        expect(usesVue(null)).toBe(false);
    });

    it('keeps the PHP index in the install and its telemetry off', () => {
        const [php] = KIND_PROFILES.php.components;
        expect(php.initializationOptions(context)).toEqual({
            storagePath: '/home/.ruimte/language-servers/vue/storage',
            globalStoragePath: '/home/.ruimte/language-servers/vue/storage'
        });
        expect(php.env).toEqual({ INTELEPHENSE_TELEMETRY_ENABLED: 'false' });
    });

    it('prefers the TypeScript of the project and falls back to the pinned one', async () => {
        const has = new Set(['/work/app/node_modules/typescript/lib/tsserver.js']);
        const exists = async (path: string) => has.has(path);
        expect(await resolveTypescriptLib('/work/app', '/install/typescript', exists)).toBe('/work/app/node_modules/typescript/lib');
        expect(await resolveTypescriptLib('/work/other', '/install/typescript', exists)).toBe('/install/typescript/node_modules/typescript/lib');
    });
});

describe('pinned versions', () => {
    it('pins every package a kind installs, exactly', () => {
        for (const packages of Object.values(LANGUAGE_KIND_PACKAGES)) {
            for (const name of packages) {
                expect(LANGUAGE_PACKAGE_VERSIONS[name]).toMatch(/^\d+\.\d+\.\d+$/);
            }
        }
        expect(pinnedVersionsOf('php')).toEqual({ intelephense: '1.18.5' });
        expect(Object.keys(pinnedVersionsOf('vue'))).toEqual(['typescript-language-server', 'typescript', '@vue/language-server', '@vue/typescript-plugin']);
        expect(versionOf('typescript')).toBe('6.0.1');
        expect(versionOf('vue')).toBe('3.3.12');
    });
});
