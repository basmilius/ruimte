import { join } from 'node:path';
import type { LanguageServerKind } from '@ruimte/contracts';

/* What a component needs to know about where it runs. */
export interface LaunchContext {
    /* `$RUIMTE_HOME/language-servers/<kind>`, with the pinned packages in its `node_modules`. */
    installDirectory: string;
    projectFolder: string;
    /* The `lib` folder of the TypeScript SDK to use: the project's own when it has one, else the pinned one. */
    typescriptLib: string;
}

/* One process of a kind. Vue runs two: the Vue server and the TypeScript server it leans on. */
export interface ComponentProfile {
    /* Names the process on the wire, in a diagnostics report and in the capabilities of a status. */
    name: string;
    /* The language ids it serves, as LSP names them. */
    languages: readonly string[];
    /* The script it runs, relative to the `node_modules` of the install. */
    entry: string;
    args(context: LaunchContext): string[];
    initializationOptions(context: LaunchContext): unknown;
    /* Settings the server reads through `workspace/didChangeConfiguration` and `workspace/configuration`, which are not initialization options. */
    configuration?: Record<string, unknown>;
    env?: Record<string, string>;
    /* A server told that the client pulls diagnostics stops pushing them, so the daemon asks for them (`textDocument/diagnostic`). */
    pullDiagnostics?: boolean;
}

export interface KindProfile {
    kind: LanguageServerKind;
    /* In the order they start, since the second may need the first. */
    components: readonly ComponentProfile[];
}

const SCRIPT_LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'] as const;

const TYPESCRIPT_PREFERENCES = {
    includeCompletionsForModuleExports: true,
    includeInlayParameterNameHints: 'all',
    includeInlayVariableTypeHints: true,
    includeInlayFunctionLikeReturnTypeHints: true,
    includeInlayFunctionParameterTypeHints: true
};

function typescriptComponent(languages: readonly string[], withVuePlugin: boolean): ComponentProfile {
    return {
        name: 'typescript',
        languages,
        entry: 'typescript-language-server/lib/cli.mjs',
        args: () => ['--stdio'],
        // A function or method completes as a call with its parameters as tab stops.
        configuration: { completions: { completeFunctionCalls: true } },
        initializationOptions: (context) => ({
            hostInfo: 'ruimte',
            // Fetching typings is the project's own package manager's job, and the daemon makes no request nobody asked for.
            disableAutomaticTypingAcquisition: true,
            tsserver: { path: join(context.typescriptLib, 'tsserver.js'), useSyntaxServer: 'never' },
            preferences: TYPESCRIPT_PREFERENCES,
            ...(withVuePlugin
                ? { plugins: [{ name: '@vue/typescript-plugin', location: join(context.installDirectory, 'node_modules'), languages: ['vue'] }] }
                : {})
        })
    };
}

/* Packages in `vscode-langservers-extracted` are separate servers, each with a script of its own. */
function extractedScript(name: string): string {
    return `vscode-langservers-extracted/bin/vscode-${name}-language-server`;
}

/*
 * `@import` and `@apply` of Tailwind, `@custom-media` and the like are what most projects with a
 * stylesheet use, and the server answers them with a warning each.
 */
const STYLE_SETTINGS = { validate: true, lint: { unknownAtRules: 'ignore' } };

/*
 * The schemas the JSON server associates by file name. The server fetches one from its host the first
 * time a matching file opens, and never otherwise.
 */
const JSON_SCHEMAS = [
    { fileMatch: ['package.json'], url: 'https://www.schemastore.org/package.json' },
    { fileMatch: ['tsconfig.json', 'tsconfig.*.json'], url: 'https://www.schemastore.org/tsconfig.json' },
    { fileMatch: ['jsconfig.json', 'jsconfig.*.json'], url: 'https://www.schemastore.org/jsconfig.json' },
    { fileMatch: ['composer.json'], url: 'https://getcomposer.org/schema.json' },
    { fileMatch: ['.eslintrc', '.eslintrc.json'], url: 'https://www.schemastore.org/eslintrc.json' },
    { fileMatch: ['.prettierrc', '.prettierrc.json'], url: 'https://www.schemastore.org/prettierrc.json' },
    { fileMatch: ['.babelrc', '.babelrc.json', 'babel.config.json'], url: 'https://www.schemastore.org/babelrc.json' },
    { fileMatch: ['.stylelintrc', '.stylelintrc.json'], url: 'https://www.schemastore.org/stylelintrc.json' },
    { fileMatch: ['renovate.json', '.renovaterc', '.renovaterc.json'], url: 'https://www.schemastore.org/renovate.json' },
    { fileMatch: ['lerna.json'], url: 'https://www.schemastore.org/lerna.json' }
];

/*
 * The schema store of the YAML server is off: it downloads the whole catalog when the server starts,
 * whatever file is open. These associations are fetched like the JSON ones, when a matching file opens.
 */
const YAML_SCHEMAS = {
    'https://www.schemastore.org/github-workflow.json': ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
    'https://www.schemastore.org/github-action.json': ['action.yml', 'action.yaml', '.github/actions/*/action.yml', '.github/actions/*/action.yaml'],
    'https://www.schemastore.org/dependabot-2.0.json': ['.github/dependabot.yml', '.github/dependabot.yaml'],
    'https://raw.githubusercontent.com/compose-spec/compose-go/main/schema/compose-spec.json': [
        'docker-compose.yml',
        'docker-compose.*.yml',
        'compose.yml',
        'compose.*.yml'
    ]
};

export const KIND_PROFILES: Record<LanguageServerKind, KindProfile> = {
    typescript: { kind: 'typescript', components: [typescriptComponent(SCRIPT_LANGUAGES, false)] },
    vue: {
        kind: 'vue',
        components: [
            // The one TypeScript server of a project that uses Vue serves its scripts too, so a `.ts` file that imports a `.vue` one gets its types and only one tsserver runs.
            typescriptComponent([...SCRIPT_LANGUAGES, 'vue'], true),
            {
                name: 'vue',
                languages: ['vue'],
                entry: '@vue/language-server/bin/vue-language-server.js',
                args: (context) => ['--stdio', `--tsdk=${context.typescriptLib}`],
                initializationOptions: () => ({})
            }
        ]
    },
    php: {
        kind: 'php',
        components: [
            {
                name: 'php',
                languages: ['php'],
                entry: 'intelephense/lib/intelephense.js',
                args: () => ['--stdio'],
                initializationOptions: (context) => ({
                    storagePath: join(context.installDirectory, 'storage'),
                    globalStoragePath: join(context.installDirectory, 'storage')
                }),
                env: { INTELEPHENSE_TELEMETRY_ENABLED: 'false' }
            }
        ]
    },
    css: {
        kind: 'css',
        components: [
            {
                name: 'css',
                languages: ['css', 'scss', 'less'],
                entry: extractedScript('css'),
                args: () => ['--stdio'],
                initializationOptions: () => ({ provideFormatter: true }),
                configuration: { css: STYLE_SETTINGS, scss: STYLE_SETTINGS, less: STYLE_SETTINGS },
                pullDiagnostics: true
            }
        ]
    },
    html: {
        kind: 'html',
        components: [
            {
                name: 'html',
                languages: ['html'],
                entry: extractedScript('html'),
                args: () => ['--stdio'],
                initializationOptions: () => ({
                    provideFormatter: true,
                    embeddedLanguages: { css: true, javascript: true },
                    configurationSection: ['html', 'css', 'javascript']
                }),
                configuration: { html: { validate: { scripts: true, styles: true } }, css: STYLE_SETTINGS },
                pullDiagnostics: true
            }
        ]
    },
    json: {
        kind: 'json',
        components: [
            {
                name: 'json',
                languages: ['json', 'jsonc'],
                entry: extractedScript('json'),
                args: () => ['--stdio'],
                initializationOptions: () => ({ provideFormatter: true }),
                configuration: { json: { validate: { enable: true }, format: { enable: true }, schemas: JSON_SCHEMAS } },
                pullDiagnostics: true
            }
        ]
    },
    yaml: {
        kind: 'yaml',
        components: [
            {
                name: 'yaml',
                languages: ['yaml'],
                entry: 'yaml-language-server/bin/yaml-language-server',
                args: () => ['--stdio'],
                initializationOptions: () => ({}),
                configuration: { yaml: { validate: true, format: { enable: true }, schemaStore: { enable: false }, schemas: YAML_SCHEMAS } }
            }
        ]
    },
    python: {
        kind: 'python',
        components: [
            {
                name: 'python',
                languages: ['python'],
                entry: 'pyright/langserver.index.js',
                args: () => ['--stdio'],
                initializationOptions: () => ({}),
                configuration: { python: { analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly' } } },
                pullDiagnostics: true
            }
        ]
    },
    bash: {
        kind: 'bash',
        components: [
            {
                name: 'bash',
                languages: ['shellscript'],
                entry: 'bash-language-server/out/cli.js',
                args: () => ['start'],
                initializationOptions: () => ({})
            }
        ]
    },
    docker: {
        kind: 'docker',
        components: [
            {
                name: 'docker',
                languages: ['dockerfile'],
                entry: 'dockerfile-language-server-nodejs/bin/docker-langserver',
                args: () => ['--stdio'],
                initializationOptions: () => ({})
            }
        ]
    }
};

/* The names a client may use for a language, by the id LSP gives it. */
const LANGUAGE_ALIASES: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    mjs: 'javascript',
    cjs: 'javascript',
    mts: 'typescript',
    cts: 'typescript',
    sh: 'shellscript',
    bash: 'shellscript',
    zsh: 'shellscript',
    docker: 'dockerfile',
    yml: 'yaml',
    py: 'python'
};

export function lspLanguageId(languageId: string): string {
    return LANGUAGE_ALIASES[languageId] ?? languageId;
}

/* Files that are JSON with comments and trailing commas: a JSON server reports both as errors in a plain `json` document. */
const JSONC_FILES =
    /(^|\/)(tsconfig(\..+)?\.json|jsconfig(\..+)?\.json|\.eslintrc(\.json)?|\.babelrc(\.json)?|\.swcrc|devcontainer\.json|\.devcontainer\/.+\.json|\.vscode\/.+\.json|.+\.jsonc)$/;

/* The language id a document opens with: the client's, except for a JSON file that allows comments. */
export function documentLanguageId(languageId: string, storedPath: string): string {
    const id = lspLanguageId(languageId);
    return id === 'json' && JSONC_FILES.test(storedPath) ? 'jsonc' : id;
}

/* The kind that serves a language, or null for one no server here knows. */
export function kindForLanguage(languageId: string): LanguageServerKind | null {
    const id = lspLanguageId(languageId);
    return (Object.values(KIND_PROFILES).find((profile) => profile.components.some((component) => component.languages.includes(id)))?.kind ??
        null) as LanguageServerKind | null;
}

/*
 * The TypeScript SDK a project's servers drive: the project's own when it has a `typescript` package
 * with a tsserver in it, since that is the version its code is written against. TypeScript 7 ships no
 * tsserver.js, so a project on it falls back to the pinned one.
 */
export async function resolveTypescriptLib(projectFolder: string, installDirectory: string, exists: (path: string) => Promise<boolean>): Promise<string> {
    const own = join(projectFolder, 'node_modules', 'typescript', 'lib');
    if (await exists(join(own, 'tsserver.js'))) {
        return own;
    }
    return join(installDirectory, 'node_modules', 'typescript', 'lib');
}

const VUE_PACKAGES = /^(vue|nuxt|@nuxt\/.+|@vue\/.+|@vitejs\/plugin-vue)$/;

/* Whether the text of a `package.json` names Vue or something built on it, in any kind of dependency. */
export function usesVue(packageJson: string | null): boolean {
    if (packageJson === null) {
        return false;
    }
    try {
        const parsed = JSON.parse(packageJson) as Record<string, unknown>;
        return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((field) => {
            const dependencies = parsed[field];
            return typeof dependencies === 'object' && dependencies !== null && Object.keys(dependencies).some((name) => VUE_PACKAGES.test(name));
        });
    } catch {
        return false;
    }
}
