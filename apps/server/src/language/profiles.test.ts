import { describe, expect, it } from 'bun:test';
import {
    activates,
    additionKindsForLanguage,
    documentLanguageId,
    KIND_PROFILES,
    kindForLanguage,
    lspLanguageId,
    resolveNativeTypescript,
    resolveTypescriptLib,
    usesVue
} from './profiles.ts';
import { LANGUAGE_KIND_PACKAGES, LANGUAGE_PACKAGE_VERSIONS, pinnedVersionsOf, versionOf } from './versions.ts';

const context = {
    installDirectory: '/home/.ruimte/language-servers/vue',
    projectFolder: '/work/app',
    typescriptLib: '/work/app/node_modules/typescript/lib',
    typescriptExecutable: '/work/app/node_modules/@typescript/native/lib/tsc'
};
const nativeEntry = `@typescript/typescript-${process.platform}-${process.arch}/lib/${process.platform === 'win32' ? 'tsc.exe' : 'tsc'}`;

describe('server profiles', () => {
    it('routes a language to the kind that serves it', () => {
        expect(kindForLanguage('typescript')).toBe('typescript');
        expect(kindForLanguage('tsx')).toBe('typescript');
        expect(kindForLanguage('javascriptreact')).toBe('typescript');
        expect(kindForLanguage('vue')).toBe('vue');
        expect(kindForLanguage('php')).toBe('php');
        expect(kindForLanguage('scss')).toBe('css');
        expect(kindForLanguage('less')).toBe('css');
        expect(kindForLanguage('html')).toBe('html');
        expect(kindForLanguage('jsonc')).toBe('json');
        expect(kindForLanguage('yaml')).toBe('yaml');
        expect(kindForLanguage('python')).toBe('python');
        expect(kindForLanguage('sh')).toBe('bash');
        expect(kindForLanguage('docker')).toBe('docker');
        expect(kindForLanguage('rust')).toBeNull();
        expect(lspLanguageId('tsx')).toBe('typescriptreact');
        expect(lspLanguageId('php')).toBe('php');
    });

    it('keeps ESLint and Tailwind out of the kind of a language, and offers them beside it', () => {
        expect(kindForLanguage('typescript')).toBe('typescript');
        expect(kindForLanguage('css')).toBe('css');
        expect(additionKindsForLanguage('typescript')).toEqual(['eslint', 'tailwind']);
        expect(additionKindsForLanguage('vue')).toEqual(['eslint', 'tailwind']);
        expect(additionKindsForLanguage('scss')).toEqual(['tailwind']);
        expect(additionKindsForLanguage('python')).toEqual([]);
    });

    it('activates an addition by a config file, a dependency or a package.json field', async () => {
        const facts = (packageJson: string | null, files: string[] = []) => ({
            folder: '/work',
            packageJson,
            exists: async (path: string) => files.includes(path)
        });
        expect(await activates(KIND_PROFILES.eslint, facts(null, ['/work/eslint.config.mjs']))).toBe(true);
        expect(await activates(KIND_PROFILES.eslint, facts(null, ['/work/.eslintrc.json']))).toBe(true);
        expect(await activates(KIND_PROFILES.eslint, facts(JSON.stringify({ eslintConfig: {} })))).toBe(true);
        expect(await activates(KIND_PROFILES.eslint, facts(JSON.stringify({ devDependencies: { eslint: '^9' } })))).toBe(false);
        expect(await activates(KIND_PROFILES.tailwind, facts(JSON.stringify({ devDependencies: { '@tailwindcss/vite': '^4' } })))).toBe(true);
        expect(await activates(KIND_PROFILES.tailwind, facts(null, ['/work/tailwind.config.ts']))).toBe(true);
        expect(await activates(KIND_PROFILES.tailwind, facts('not json'))).toBe(false);
        expect(await activates(KIND_PROFILES.typescript, facts(null, ['/work/eslint.config.js']))).toBe(false);
    });

    it('opens a JSON file that allows comments as JSONC and any other as JSON', () => {
        expect(documentLanguageId('json', 'tsconfig.json')).toBe('jsonc');
        expect(documentLanguageId('json', 'packages/app/tsconfig.build.json')).toBe('jsonc');
        expect(documentLanguageId('json', '.vscode/settings.json')).toBe('jsonc');
        expect(documentLanguageId('json', 'package.json')).toBe('json');
        expect(documentLanguageId('tsx', 'a.tsx')).toBe('typescriptreact');
    });

    it('gives every server that pulls its diagnostics the pull, and lets the others push', () => {
        const pulling = Object.values(KIND_PROFILES).flatMap((profile) =>
            profile.components.filter((component) => component.pullDiagnostics).map((component) => component.name)
        );
        expect(pulling).toEqual(['typescript', 'css', 'html', 'json', 'python', 'eslint']);
    });

    it('keeps the schema store of the YAML server off', () => {
        expect(KIND_PROFILES.yaml.components[0]!.configuration).toMatchObject({ yaml: { schemaStore: { enable: false } } });
    });

    it('runs the native TypeScript server as a program of its own, over stdio, with pushed diagnostics off', () => {
        const [typescript] = KIND_PROFILES.typescript.components;
        expect(typescript).toMatchObject({ name: 'typescript', native: true, entry: nativeEntry, pullDiagnostics: true });
        expect(typescript.args(context)).toEqual(['--lsp', '--stdio']);
        expect(typescript.initializationOptions(context)).toEqual({ disablePushDiagnostics: true, logVerbosity: 4 });
    });

    it('gives the native server the inlay hints and the auto imports under the js/ts section', () => {
        expect(KIND_PROFILES.typescript.components[0]!.configuration).toEqual({
            'js/ts': {
                suggest: { autoImports: true },
                inlayHints: {
                    parameterNames: { enabled: 'all' },
                    variableTypes: { enabled: true },
                    functionLikeReturnTypes: { enabled: true },
                    parameterTypes: { enabled: true }
                }
            }
        });
    });

    it('drives the tsserver of Vue with the SDK it is given, the inlay hint preferences on, and no typings fetch', () => {
        const [typescript] = KIND_PROFILES.vue.components;
        expect(typescript.native).toBeUndefined();
        expect(typescript.initializationOptions(context)).toMatchObject({
            hostInfo: 'ruimte',
            disableAutomaticTypingAcquisition: true,
            tsserver: { path: '/work/app/node_modules/typescript/lib/tsserver.js', useSyntaxServer: 'never' },
            preferences: {
                includeCompletionsForModuleExports: true,
                includeInlayParameterNameHints: 'all',
                includeInlayVariableTypeHints: true,
                includeInlayFunctionLikeReturnTypeHints: true,
                includeInlayFunctionParameterTypeHints: true
            }
        });
        expect(typescript.args(context)).toEqual(['--stdio']);
    });

    it('has the tsserver of Vue complete a function as a call', () => {
        expect(KIND_PROFILES.vue.components[0]!.configuration).toEqual({ completions: { completeFunctionCalls: true } });
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

describe('the native TypeScript server of a project', () => {
    /* A project folder whose files are the keys, with `typescript` linked to a real folder where pnpm keeps it. */
    function files(texts: Record<string, string>, links: Record<string, string> = {}) {
        return {
            exists: async (path: string) => path in texts,
            readText: async (path: string) => texts[path] ?? null,
            realPath: async (path: string) => links[path] ?? path
        };
    }

    const pinned = `/install/typescript/node_modules/${nativeEntry}`;
    const manifest = (version: string) => JSON.stringify({ name: 'typescript', version });

    it('runs the program of the TypeScript 7 in the project, found beside the package', async () => {
        const program = `/work/app/node_modules/${nativeEntry}`;
        const lookup = files({ '/work/app/node_modules/typescript/package.json': manifest('7.1.0'), [program]: '' });
        expect(await resolveNativeTypescript('/work/app', '/install/typescript', lookup)).toBe(program);
    });

    it('finds the platform package beside the real folder of a linked typescript', async () => {
        const program = `/work/.pnpm/typescript@7.0.2/node_modules/${nativeEntry}`;
        const lookup = files(
            { '/work/app/node_modules/typescript/package.json': manifest('7.0.2'), [program]: '' },
            { '/work/app/node_modules/typescript': '/work/.pnpm/typescript@7.0.2/node_modules/typescript' }
        );
        expect(await resolveNativeTypescript('/work/app', '/install/typescript', lookup)).toBe(program);
    });

    it('looks upward from the folder, as a monorepo hoists its packages', async () => {
        const program = `/work/node_modules/${nativeEntry}`;
        const lookup = files({ '/work/node_modules/typescript/package.json': manifest('7.0.2'), [program]: '' });
        expect(await resolveNativeTypescript('/work/packages/app', '/install/typescript', lookup)).toBe(program);
    });

    it('takes the pinned one for an older TypeScript, for none at all and for a 7 without a program for this platform', async () => {
        expect(
            await resolveNativeTypescript('/work/app', '/install/typescript', files({ '/work/app/node_modules/typescript/package.json': manifest('6.0.3') }))
        ).toBe(pinned);
        expect(await resolveNativeTypescript('/work/app', '/install/typescript', files({}))).toBe(pinned);
        expect(
            await resolveNativeTypescript('/work/app', '/install/typescript', files({ '/work/app/node_modules/typescript/package.json': manifest('7.0.2') }))
        ).toBe(pinned);
        expect(await resolveNativeTypescript('/work/app', '/install/typescript', files({ '/work/app/node_modules/typescript/package.json': 'not json' }))).toBe(
            pinned
        );
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
        expect(pinnedVersionsOf('vue').typescript).toBe('6.0.3');
        expect(pinnedVersionsOf('typescript')).toEqual({ typescript: '7.0.2' });
        expect(versionOf('typescript')).toBe('7.0.2');
        expect(versionOf('vue')).toBe('3.3.12');
        expect(pinnedVersionsOf('css')).toEqual(pinnedVersionsOf('json'));
        expect(versionOf('python')).toBe(LANGUAGE_PACKAGE_VERSIONS.pyright);
    });
});
