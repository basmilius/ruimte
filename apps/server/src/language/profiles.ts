import { dirname, join } from 'node:path';
import { matchesFilePattern, type LanguageServerId, type LanguageServerKind } from '@ruimte/contracts';
import { nativeStorageOf, nativeStubsOf } from './native.ts';

/* What a component needs to know about where it runs. */
export interface LaunchContext {
    /* `$RUIMTE_HOME/language-servers/<kind>`, with the pinned packages in its `node_modules`. */
    installDirectory: string;
    projectFolder: string;
    /* The `lib` folder of the TypeScript SDK to use: the project's own when it has one, else the pinned one. */
    typescriptLib: string;
    /* The native TypeScript server to run: the project's own when it is TypeScript 7 or newer, else the pinned one. */
    typescriptExecutable: string;
    /* A kind whose server is a program of its own: the file it runs and the commit of the stubs installed beside it, for a kind that reads them. Null for any other kind. */
    native?: { executable: string; stubsCommit?: string } | null;
    /* What the project's SQL comes down to for the servers that read it (`sql-settings.ts`); null before anything was worked out. */
    sql?: ProjectSqlSettings | null;
}

/* The settings of the project's SQL as each server that reads it takes them. */
export interface ProjectSqlSettings {
    /* `sqlLanguageServer` of the SQL server. */
    sql: Record<string, unknown>;
    /* `sql` of the PHP server, under `phpLanguageServer`. */
    php: Record<string, unknown>;
    /* The files a person set to no connection. An override cannot take a schema away, so each is answered on its own through `workspace/configuration`. */
    unbound: readonly string[];
}

/* What a file a person set to no connection is read as: no dialect and no schema, whatever the project's default says. */
export const UNBOUND_SQL = { dialect: 'generic' };

/* One process of a kind. Vue runs two: the Vue server and the TypeScript server it leans on. */
export interface ComponentProfile {
    /* Names the process on the wire, in a diagnostics report and in the capabilities of a status. */
    name: string;
    /* What the failure of this process is called to a person, where the name on the wire is an id. */
    title?: string;
    /* The language ids it serves, as LSP names them. */
    languages: readonly string[];
    /* File patterns it serves besides those languages (`matchesFilePattern`), such as the templates of a language the editor does not name. */
    patterns?: readonly string[];
    /* File patterns of a language another kind serves, which this process serves beside that kind, in a project that calls for it. */
    alongside?: { patterns: readonly string[]; activation: Activation };
    /* The script it runs, relative to the `node_modules` of the install. Empty for a server with a `command`. */
    entry: string;
    /* Whether the entry is a program of its own, which runs as it is and not under the daemon's runtime. */
    native?: boolean;
    /* The program of a kind installed through `native.ts`, which runs as it is. `entry` is then only its file name. */
    program?(context: LaunchContext): string;
    /* A server of a person's own: the command that starts it, run as it is and not under the daemon's runtime. */
    command?: string;
    args(context: LaunchContext): string[];
    initializationOptions(context: LaunchContext): unknown;
    /* Settings the server reads through `workspace/didChangeConfiguration` and `workspace/configuration`, which are not initialization options. */
    configuration?: Record<string, unknown>;
    /*
     * Settings of the project the server reads beside `configuration`, sent at the start and again every
     * time they change. With a path they are the answer to `workspace/configuration` for that document.
     */
    settings?(context: LaunchContext, path?: string): Record<string, unknown>;
    env?: Record<string, string>;
    /* A server told that the client pulls diagnostics stops pushing them, so the daemon asks for them (`textDocument/diagnostic`). */
    pullDiagnostics?: boolean;
    /* Starts the first time code actions are asked for a document it serves, and is asked for code actions only; its diagnostics are never shown. */
    sidecar?: boolean;
    /* The package under the install's `node_modules` whose `lib/tsserver.js` the process drives when the project has none of its own; `typescript` when absent. */
    sdkPackage?: string;
}

/* What a project has to hold for an addition to serve it: any of the files, or a dependency, or a field of its `package.json`. */
export interface Activation {
    files: readonly string[];
    dependency?: RegExp;
    packageField?: string;
}

export interface KindProfile {
    kind: LanguageServerId;
    /* In the order they start, since the second may need the first. */
    components: readonly ComponentProfile[];
    /* Kinds with the same choice are alternatives to each other, named by the language id they serve; the machine uses one of them at a time. */
    choice?: string;
    /* Set for a kind that serves beside the kind of the language, in the projects that call for it, rather than instead of it. */
    activation?: Activation;
}

/* Where the TypeScript 6 SDK of the `typescript` kind sits beside its TypeScript 7 package, under an alias of the same npm package. */
const SIDECAR_SDK_PACKAGE = 'typescript-6';

const SCRIPT_LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'] as const;

/* `sql` names no dialect; the others name the one the SQL server reads a document in when its settings do not. */
const SQL_LANGUAGES = ['sql', 'mysql', 'mariadb', 'postgres', 'sqlite'] as const;

/* The server's `logVerbosity` that keeps warnings and errors only. */
const LOG_VERBOSITY_WARNING = 4;

const TYPESCRIPT_PREFERENCES = {
    includeCompletionsForModuleExports: true,
    includeInlayParameterNameHints: 'all',
    includeInlayVariableTypeHints: true,
    includeInlayFunctionLikeReturnTypeHints: true,
    includeInlayFunctionParameterTypeHints: true
};

/* The native server of TypeScript 7 sits in the package of the platform the `typescript` package pulls in. */
const NATIVE_ENTRY = `@typescript/typescript-${process.platform}-${process.arch}/lib/${process.platform === 'win32' ? 'tsc.exe' : 'tsc'}`;

/*
 * The native server asks for the sections `js/ts`, `typescript`, `javascript` and `editor`, in rising
 * precedence up to `js/ts`. It has no setting for `completeFunctionCalls`; the client adds the parentheses of a call itself.
 */
const NATIVE_TYPESCRIPT_SETTINGS = {
    'js/ts': {
        suggest: { autoImports: true },
        inlayHints: {
            parameterNames: { enabled: 'all' },
            variableTypes: { enabled: true },
            functionLikeReturnTypes: { enabled: true },
            parameterTypes: { enabled: true }
        }
    }
};

function nativeTypescriptComponent(): ComponentProfile {
    return {
        name: 'typescript',
        languages: SCRIPT_LANGUAGES,
        entry: NATIVE_ENTRY,
        native: true,
        args: () => ['--lsp', '--stdio'],
        // Diagnostics are pulled, and a server that logs every snapshot it takes would fill the log with it.
        initializationOptions: () => ({ disablePushDiagnostics: true, logVerbosity: LOG_VERBOSITY_WARNING }),
        configuration: NATIVE_TYPESCRIPT_SETTINGS,
        pullDiagnostics: true
    };
}

/*
 * TypeScript 7 has most quick fixes missing and no refactors, so a second process of TypeScript 6 behind
 * typescript-language-server answers the code actions it lacks. It starts with the first code action asked for.
 */
function typescriptActionsComponent(): ComponentProfile {
    return {
        name: 'typescript-actions',
        title: 'TypeScript 6',
        languages: SCRIPT_LANGUAGES,
        entry: 'typescript-language-server/lib/cli.mjs',
        sidecar: true,
        sdkPackage: SIDECAR_SDK_PACKAGE,
        args: () => ['--stdio'],
        initializationOptions: (context) => ({
            hostInfo: 'ruimte',
            disableAutomaticTypingAcquisition: true,
            tsserver: { path: join(context.typescriptLib, 'tsserver.js'), useSyntaxServer: 'never' },
            preferences: TYPESCRIPT_PREFERENCES
        })
    };
}

/* TypeScript 7 has no plugin API, so Vue keeps a tsserver of TypeScript 6 behind typescript-language-server, which loads `@vue/typescript-plugin`. */
function vueTypescriptComponent(): ComponentProfile {
    return {
        name: 'typescript',
        languages: [...SCRIPT_LANGUAGES, 'vue'],
        entry: 'typescript-language-server/lib/cli.mjs',
        args: () => ['--stdio'],
        initializationOptions: (context) => ({
            hostInfo: 'ruimte',
            // Fetching typings is the project's own package manager's job, and the daemon makes no request nobody asked for.
            disableAutomaticTypingAcquisition: true,
            tsserver: { path: join(context.typescriptLib, 'tsserver.js'), useSyntaxServer: 'never' },
            preferences: TYPESCRIPT_PREFERENCES,
            plugins: [{ name: '@vue/typescript-plugin', location: join(context.installDirectory, 'node_modules'), languages: ['vue'] }]
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

/*
 * What the ESLint server reads for each file it lints. `probe` stays quiet for a file ESLint cannot lint
 * with the project's configuration, and the search for a global install is off since the project's own is
 * the one to lint with.
 */
const ESLINT_SETTINGS = {
    validate: 'probe',
    run: 'onType',
    packageManager: null,
    nodePath: null,
    quiet: false,
    format: false,
    onIgnoredFiles: 'off',
    options: {},
    rulesCustomizations: [],
    experimental: {},
    problems: { shortenToSingleLine: false },
    workingDirectory: { mode: 'location' },
    codeActionOnSave: { enable: false, mode: 'all' },
    codeAction: { disableRuleComment: { enable: true, location: 'separateLine', commentStyle: 'line' }, showDocumentation: { enable: true } }
};

const TAILWIND_SETTINGS = {
    editor: { tabSize: 4 },
    tailwindCSS: {
        validate: true,
        emmetCompletions: false,
        classAttributes: ['class', 'className', 'ngClass', 'class:list'],
        includeLanguages: {},
        experimental: { classRegex: [] }
    }
};

export const KIND_PROFILES: Record<LanguageServerKind, KindProfile> = {
    typescript: { kind: 'typescript', components: [nativeTypescriptComponent(), typescriptActionsComponent()] },
    vue: {
        kind: 'vue',
        components: [
            // The one TypeScript server of a project that uses Vue serves its scripts too, so a `.ts` file that imports a `.vue` one gets its types and only one tsserver runs.
            vueTypescriptComponent(),
            {
                name: 'vue',
                languages: ['vue'],
                entry: '@vue/language-server/bin/vue-language-server.js',
                args: (context) => ['--stdio', `--tsdk=${context.typescriptLib}`],
                initializationOptions: () => ({})
            }
        ]
    },
    // The default for PHP, ahead of Intelephense, which stays an alternative the machine can pick.
    'php-native': {
        kind: 'php-native',
        choice: 'php',
        components: [
            {
                name: 'php-native',
                // A Blade template opens as `php`; the server reads it as Blade by its `.blade.php` name.
                languages: ['php', 'blade', 'twig'],
                patterns: ['*.phtml', '*.twig'],
                // The configuration of a Symfony project, which the server answers in and is silent about elsewhere.
                alongside: {
                    patterns: ['config/**/*.yaml', 'config/**/*.yml', 'translations/**/*.yaml', 'translations/**/*.yml'],
                    activation: { files: ['composer.json'] }
                },
                entry: 'php-language-server',
                program: (context) => context.native?.executable ?? '',
                args: () => ['--stdio'],
                // The server reads `composer.json` for the language level. The stubs are fetched by Install, so `stubsPath` keeps it from downloading anything itself.
                initializationOptions: (context) => ({
                    storagePath: nativeStorageOf(context.installDirectory),
                    stubsPath: nativeStubsOf(context.installDirectory, context.native?.stubsCommit ?? ''),
                    ...(context.sql ? { sql: context.sql.php } : {})
                }),
                // The SQL in its strings is read against the project's connection, which a person may change while it runs.
                settings: (context) => (context.sql ? { phpLanguageServer: { sql: context.sql.php } } : {}),
                pullDiagnostics: true
            }
        ]
    },
    'sql-native': {
        kind: 'sql-native',
        components: [
            {
                name: 'sql-native',
                languages: SQL_LANGUAGES,
                entry: 'sql-language-server',
                program: (context) => context.native?.executable ?? '',
                args: () => ['--stdio'],
                initializationOptions: (context) => ({ sqlLanguageServer: context.sql?.sql ?? {} }),
                settings: (context, path) => ({
                    sqlLanguageServer: path !== undefined && context.sql?.unbound.includes(path) ? UNBOUND_SQL : (context.sql?.sql ?? {})
                }),
                pullDiagnostics: true
            }
        ]
    },
    php: {
        kind: 'php',
        choice: 'php',
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
    },
    eslint: {
        kind: 'eslint',
        activation: {
            files: [
                ...['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((extension) => `eslint.config.${extension}`),
                ...['', '.js', '.cjs', '.json', '.yaml', '.yml'].map((extension) => `.eslintrc${extension}`)
            ],
            packageField: 'eslintConfig'
        },
        components: [
            {
                name: 'eslint',
                languages: [...SCRIPT_LANGUAGES, 'vue'],
                entry: extractedScript('eslint'),
                args: () => ['--stdio'],
                initializationOptions: () => ({}),
                configuration: ESLINT_SETTINGS,
                pullDiagnostics: true
            }
        ]
    },
    tailwind: {
        kind: 'tailwind',
        activation: {
            files: ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts'].map((extension) => `tailwind.config.${extension}`),
            dependency: /^(tailwindcss|@tailwindcss\/.+)$/
        },
        components: [
            {
                name: 'tailwind',
                languages: ['html', 'css', 'scss', 'less', ...SCRIPT_LANGUAGES, 'vue', 'php'],
                entry: '@tailwindcss/language-server/bin/tailwindcss-language-server',
                args: () => ['--stdio'],
                initializationOptions: () => ({}),
                configuration: TAILWIND_SETTINGS
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

/* Whether a process serves a document, by its language or by its path. */
export function componentServes(component: ComponentProfile, languageId: string, storedPath: string): boolean {
    return component.languages.includes(lspLanguageId(languageId)) || servesPath(component, storedPath) || servesAlongside(component, storedPath);
}

function catalog(): [LanguageServerKind, KindProfile][] {
    return Object.entries(KIND_PROFILES) as [LanguageServerKind, KindProfile][];
}

function serves(profile: KindProfile, languageId: string): boolean {
    return profile.components.some((component) => component.languages.includes(lspLanguageId(languageId)));
}

/* The server a machine picked for each choice (`KindProfile.choice`). */
export type LanguagePreferences = Readonly<Record<string, LanguageServerKind | undefined>>;

function primaryKinds(languageId: string): LanguageServerKind[] {
    return catalog()
        .filter(([, profile]) => profile.activation === undefined && serves(profile, languageId))
        .map(([kind]) => kind);
}

/*
 * The kind that serves a language, or null for one no server here knows. Of kinds that are alternatives
 * to each other the machine's pick serves, else the first of the catalog. A file whose language nothing
 * serves still goes to the kind that names its path, such as a `.phtml` template.
 */
export function kindForLanguage(languageId: string, preferred: LanguagePreferences = {}, storedPath?: string): LanguageServerKind | null {
    const kinds = primaryKinds(languageId);
    if (kinds.length === 0 && storedPath !== undefined) {
        const named = catalog().find(
            ([, profile]) => profile.activation === undefined && profile.components.some((component) => servesPath(component, storedPath))
        );
        return named?.[0] ?? null;
    }
    const picked = kinds.find((kind) => {
        const { choice } = KIND_PROFILES[kind];
        return choice !== undefined && preferred[choice] === kind;
    });
    return picked ?? kinds[0] ?? null;
}

function servesPath(component: ComponentProfile, storedPath: string): boolean {
    return (component.patterns ?? []).some((pattern) => matchesFilePattern(pattern, storedPath));
}

function servesAlongside(component: ComponentProfile, storedPath: string): boolean {
    return (component.alongside?.patterns ?? []).some((pattern) => matchesFilePattern(pattern, storedPath));
}

/* The kinds that serve what this one does, instead of it: the machine uses one of them at a time. Empty for a kind with no alternative. */
export function alternativesOf(kind: LanguageServerKind): LanguageServerKind[] {
    const { choice } = KIND_PROFILES[kind];
    return choice === undefined ? [] : catalog().flatMap(([other, profile]) => (other !== kind && profile.choice === choice ? [other] : []));
}

/* The kinds that serve a language beside its own, in a project that calls for them, in the order of the catalog. */
export function additionKindsForLanguage(languageId: string): LanguageServerKind[] {
    return catalog()
        .filter(([, profile]) => profile.activation !== undefined && serves(profile, languageId))
        .map(([kind]) => kind);
}

/* The kinds that serve a file by its path beside the kind of its language, with what a project has to hold for each, in the order of the catalog. */
export function alongsideKindsForPath(storedPath: string): Array<[LanguageServerKind, { activation: Activation }]> {
    return catalog().flatMap(([kind, profile]) =>
        profile.components.flatMap((component) =>
            component.alongside !== undefined && servesAlongside(component, storedPath) ? [[kind, component.alongside] as const] : []
        )
    );
}

/* What a project says about itself, as far as an addition needs to know. */
export interface ProjectFacts {
    folder: string;
    /* The text of the `package.json` in the folder, or null without one. */
    packageJson: string | null;
    exists(path: string): Promise<boolean>;
}

function packageJsonHas(packageJson: string | null, activation: Activation): boolean {
    if (packageJson === null) {
        return false;
    }
    try {
        const parsed = JSON.parse(packageJson) as Record<string, unknown>;
        if (activation.packageField !== undefined && parsed[activation.packageField] !== undefined) {
            return true;
        }
        const { dependency } = activation;
        return (
            dependency !== undefined &&
            ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((field) => {
                const dependencies = parsed[field];
                return typeof dependencies === 'object' && dependencies !== null && Object.keys(dependencies).some((name) => dependency.test(name));
            })
        );
    } catch {
        return false;
    }
}

/* Whether a project calls for an addition: one of its files in the project folder, or its `package.json` naming what the addition is for. */
export async function activates(profile: { activation?: Activation }, facts: ProjectFacts): Promise<boolean> {
    const { activation } = profile;
    if (activation === undefined) {
        return false;
    }
    if (packageJsonHas(facts.packageJson, activation)) {
        return true;
    }
    return (await Promise.all(activation.files.map((file) => facts.exists(join(facts.folder, file))))).some(Boolean);
}

/*
 * The TypeScript SDK a project's servers drive: the project's own when it has a `typescript` package
 * with a tsserver in it, since that is the version its code is written against. TypeScript 7 ships no
 * tsserver.js, so a project on it falls back to the pinned one.
 */
export async function resolveTypescriptLib(
    projectFolder: string,
    installDirectory: string,
    exists: (path: string) => Promise<boolean>,
    sdkPackage = 'typescript'
): Promise<string> {
    const own = join(projectFolder, 'node_modules', 'typescript', 'lib');
    if (await exists(join(own, 'tsserver.js'))) {
        return own;
    }
    return join(installDirectory, 'node_modules', sdkPackage, 'lib');
}

/* What the lookup of a project's own TypeScript reads from the file system. */
export interface NativeLookupFiles {
    exists(path: string): Promise<boolean>;
    readText(path: string): Promise<string | null>;
    realPath(path: string): Promise<string>;
}

/* The native server of the TypeScript 7 a project holds in `node_modules`, or null when it holds an older one or has no server for this platform. */
async function ownNativeTypescript(directory: string, files: NativeLookupFiles): Promise<string | null | undefined> {
    const manifest = join(directory, 'node_modules', 'typescript', 'package.json');
    const text = await files.readText(manifest);
    if (text === null) {
        return undefined;
    }
    try {
        if (Number.parseInt((JSON.parse(text) as { version?: string }).version ?? '', 10) < 7) {
            return null;
        }
        // The platform package is a sibling of `typescript` where it really is, which holds for npm, bun and pnpm layouts alike.
        const program = join(dirname(await files.realPath(dirname(manifest))), NATIVE_ENTRY);
        return (await files.exists(program)) ? program : null;
    } catch {
        return null;
    }
}

/*
 * The native TypeScript server a project runs: the one of its own `typescript` when that is 7 or newer,
 * found from the project folder upward the way the package itself would resolve, else the pinned one.
 */
export async function resolveNativeTypescript(projectFolder: string, installDirectory: string, files: NativeLookupFiles): Promise<string> {
    for (let directory = projectFolder; ; directory = dirname(directory)) {
        const own = await ownNativeTypescript(directory, files);
        if (own !== undefined) {
            return own ?? pinnedNativeTypescript(installDirectory);
        }
        if (dirname(directory) === directory) {
            return pinnedNativeTypescript(installDirectory);
        }
    }
}

function pinnedNativeTypescript(installDirectory: string): string {
    return join(installDirectory, 'node_modules', NATIVE_ENTRY);
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
