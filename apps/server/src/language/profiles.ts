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
    name: 'typescript' | 'vue' | 'php';
    /* The language ids it serves, as LSP names them. */
    languages: readonly string[];
    /* The script it runs, relative to the `node_modules` of the install. */
    entry: string;
    args(context: LaunchContext): string[];
    initializationOptions(context: LaunchContext): unknown;
    env?: Record<string, string>;
}

export interface KindProfile {
    kind: LanguageServerKind;
    /* In the order they start, since the second may need the first. */
    components: readonly ComponentProfile[];
}

const SCRIPT_LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'] as const;

const TYPESCRIPT_PREFERENCES = {
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

export const KIND_PROFILES: Record<LanguageServerKind, KindProfile> = {
    typescript: { kind: 'typescript', components: [typescriptComponent(SCRIPT_LANGUAGES, false)] },
    vue: {
        kind: 'vue',
        components: [
            typescriptComponent(['vue'], true),
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
    cts: 'typescript'
};

export function lspLanguageId(languageId: string): string {
    return LANGUAGE_ALIASES[languageId] ?? languageId;
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
