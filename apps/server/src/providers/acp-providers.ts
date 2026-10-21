import { join } from 'node:path';
import { z } from 'zod';
import { ModelOptionDescriptorSchema } from '@ruimte/contracts';
import { runProcess } from '@adecore/agents';
import type { AcpClientInfo, AcpModeMap, AcpPermissionRequest } from '@adecore/agents/chat';
import {
    ModelCatalog,
    createAcpProvider,
    isOnlyCommands,
    type AccountReading,
    type AcpCatalogStore,
    type AcpProviderSpec,
    type ChatProvider,
    type ProviderHome
} from '@adecore/agents/providers';
import antigravityRelease from './antigravity-acp-release.json' with { type: 'json' };
import { parseAcpServerRelease, type AcpServerLaunch } from './acp-server.ts';

// How the daemon names itself to every ACP agent it starts.
export const RUIMTE_ACP_CLIENT: AcpClientInfo = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

// The model these CLIs pick themselves; the agent is then left its own choice instead of being told one.
export const AGENT_DEFAULT_MODEL = 'default';

function agentDefaultCatalog(): ModelCatalog {
    return new ModelCatalog({
        defaultModel: AGENT_DEFAULT_MODEL,
        profiles: { agent: { options: [], contextWindowTokens: {} } },
        models: [{ slug: AGENT_DEFAULT_MODEL, name: 'Default', profile: 'agent' }]
    });
}

function agentModel(selection: { model: string }): string | null {
    return selection.model === AGENT_DEFAULT_MODEL ? null : selection.model;
}

const CONTEXT_COMMANDS = ['ruimte-context', 'echo'];

/*
 * Lets an agent run `ruimte-context` in every runtime mode without a card, the way Claude Code's `Bash(ruimte-context *)`
 * does: the daemon checks every verb itself. `echo` may join it, since agents label the parts of one call with it.
 */
export function allowsContextCommand(request: AcpPermissionRequest): boolean {
    if (request.kind !== 'execute' || request.commands.length === 0) {
        return false;
    }
    const everyPasses = request.commands.every((command) => isOnlyCommands(command, CONTEXT_COMMANDS));
    return everyPasses && request.commands.some((command) => !isOnlyCommands(command, ['echo']));
}

/*
 * Grok's session modes (`default`, `plan`, `ask`) choose what a turn does, not what it may do without
 * asking, so only `supervised` names one; every wider runtime mode runs in `default` and the backend
 * answers the permission requests that mode allows. Ids from xai-org/grok-build (`SessionMode`).
 */
export const GROK_MODES: AcpModeMap = { supervised: ['default'] };

/*
 * Copilot's ACP modes are agent, plan and autopilot; autopilot keeps a turn going but still asks for
 * every tool (github/copilot-cli#2942), so it is no permission level and `supervised` names the agent mode.
 */
export const COPILOT_MODES: AcpModeMap = { supervised: ['https://agentclientprotocol.com/protocol/session-modes#agent'] };

/*
 * Every `ruimte-context` call goes through without a prompt, in every mode, since the daemon already enforces each
 * verb. Grok 1.0.62 takes allow rules on its TUI only (`grok agent stdio` has no such flag), and a chained command
 * passes only when every segment is allowed. Copilot's `:*` matches the command followed by a space.
 */
export const GROK_ALLOW_CONTEXT = '--allow=Bash(ruimte-context *)';
export const COPILOT_ALLOW_CONTEXT = '--allow-tool=shell(ruimte-context:*)';

/* The login Grok is asked to use: the key in the environment where there is one, else the one `grok login` left. */
export function grokAuthMethod(env: Record<string, string | undefined>): string {
    return env.XAI_API_KEY ? 'xai.api_key' : 'cached_token';
}

const GROK_SPEC: AcpProviderSpec = {
    kind: 'grok',
    name: 'Grok',
    command: 'grok',
    // A chat must not wait on an update check; the flag belongs before the subcommand.
    args: ['--no-auto-update', 'agent', 'stdio'],
    catalog: agentDefaultCatalog(),
    model: agentModel,
    modes: GROK_MODES,
    loginHint: 'Run `grok login` in a terminal, or set `XAI_API_KEY`.',
    client: RUIMTE_ACP_CLIENT,
    capabilities: { terminal: true, hooks: true },
    autoAllow: allowsContextCommand,
    resumeCommand: 'grok {flags} --resume {id}',
    home: { env: 'GROK_HOME', fallback: '.grok', loginEnv: ['XAI_API_KEY'], loginCommand: 'grok login' },
    install: {
        description: "xAI's coding agent, in a terminal and in a chat.",
        commands: {
            darwin: 'curl -fsSL https://x.ai/cli/install.sh | bash',
            linux: 'curl -fsSL https://x.ai/cli/install.sh | bash',
            win32: 'irm https://x.ai/cli/install.ps1 | iex'
        },
        guideUrl: 'https://github.com/xai-org/grok-build',
        signIn: [
            { kind: 'command', command: 'grok login' },
            { kind: 'env', variable: 'XAI_API_KEY' }
        ]
    },
    // An ACP probe leaves a session folder in the account's home every time, so `grok models` answers instead (`askGrokModels`).
    accountProbe: false,
    // Headless Grok refuses every call that would ask, so the default mode keeps a title or a message from writing anything.
    oneShotArgs: (prompt) => ['--no-auto-update', '-p', prompt, '--output-format', 'plain', '--permission-mode', 'default', '--disallowed-tools', 'Agent'],
    firstPromptArgs: (prompt) => [prompt]
};

/* What `grok models` printed: who is signed in, and the models the account may use. */
export interface GrokModels {
    signedIn: boolean;
    defaultModel: string | null;
    models: string[];
}

// The first line of `grok models` in Grok 1.0.62 for each way of being signed in, and for none.
const GROK_SIGNED_IN = [/^You are logged in with /, /^You are using XAI_API_KEY\b/, /^You are authenticated via /];
const GROK_SIGNED_OUT = /^You are not authenticated\b/;

/*
 * Reads `grok models` as Grok 1.0.62 prints it: the login on the first line, `Default model: <slug>`, then
 * `Available models:` with a line per model, `*` marking the default. A first line it does not know is no answer.
 */
export function readGrokModels(output: string): GrokModels {
    const lines = output.split('\n').map((line) => line.trimEnd());
    const first = lines.find((line) => line.trim() !== '')?.trim() ?? '';
    const signedIn = GROK_SIGNED_IN.some((pattern) => pattern.test(first));
    if (!signedIn && !GROK_SIGNED_OUT.test(first)) {
        throw new Error('Grok did not say who is signed in');
    }
    const named =
        lines
            .find((line) => line.startsWith('Default model:'))
            ?.slice('Default model:'.length)
            .trim() ?? '';
    const listedFrom = lines.findIndex((line) => line.trim() === 'Available models:');
    const models: string[] = [];
    let marked: string | null = null;
    for (const line of listedFrom === -1 ? [] : lines.slice(listedFrom + 1)) {
        const match = /^\s+([*-])\s+(\S+)/.exec(line);
        // A slug may reach a command line, so one that reads as a flag is left out.
        if (match === null || match[2]!.startsWith('-')) {
            continue;
        }
        models.push(match[2]!);
        if (match[1] === '*') {
            marked = match[2]!;
        }
    }
    const defaultModel = [named, marked].find((slug) => slug !== null && models.includes(slug)) ?? null;
    return { signedIn, defaultModel, models };
}

// What `grok models` gets before the read fails; it answers from the cache in under a second.
const GROK_ASK_TIMEOUT_MS = 20_000;

/* Asks `grok models` in the account's environment (`GROK_HOME`), which opens no session. */
export async function askGrokModels(command: readonly string[], env: Record<string, string | undefined>): Promise<GrokModels> {
    const { exitCode, stdout, stderr } = await runProcess([command[0] ?? 'grok', '--no-auto-update', 'models'], {
        env,
        timeoutMs: GROK_ASK_TIMEOUT_MS,
        timeoutMessage: 'Grok did not answer in time'
    });
    if (exitCode !== 0) {
        throw new Error(stderr.trim() || `grok models exited with ${exitCode}`);
    }
    return readGrokModels(stdout);
}

// The part of an ACP catalog store's value that holds the models, as `@adecore/agents` writes it under `models`.
const StoredModelsSchema = z.object({
    defaultModel: z.string(),
    models: z.array(z.object({ slug: z.string(), name: z.string(), contextWindow: z.number().int().positive().optional() })),
    options: z.array(ModelOptionDescriptorSchema)
});

type StoredModels = z.infer<typeof StoredModelsSchema>;

function loadStored(store: AcpCatalogStore | undefined): Record<string, unknown> {
    try {
        const value = store?.load();
        return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/*
 * Lays the models `grok models` listed over the catalog and the store the way a chat's session would, keeping the
 * names, context windows and reasoning effort a chat learned, which the list does not print. Answers whether the models changed.
 */
export function adoptGrokModels(catalog: ModelCatalog, store: AcpCatalogStore | undefined, listed: GrokModels): boolean {
    if (listed.defaultModel === null) {
        return false;
    }
    const stored = loadStored(store);
    const known = StoredModelsSchema.safeParse(stored.models);
    const learned = new Map((known.success ? known.data.models : catalog.list()).map((model) => [model.slug, model]));
    const models: StoredModels['models'] = listed.models.map((slug) => {
        const model = learned.get(slug);
        const contextWindow = model !== undefined && 'contextWindow' in model ? model.contextWindow : undefined;
        return { slug, name: model?.name ?? slug, ...(contextWindow === undefined ? {} : { contextWindow }) };
    });
    const options = known.success ? known.data.options : [];
    const changed = catalog.adopt(models, listed.defaultModel, options);
    if (changed) {
        try {
            store?.save({ ...stored, models: { defaultModel: listed.defaultModel, models, options } });
        } catch {
            // A store that cannot write costs the next start this list, never this reading.
        }
    }
    return changed;
}

function storing(catalogStore: AcpCatalogStore | undefined): Pick<AcpProviderSpec, 'catalogStore'> {
    return catalogStore ? { catalogStore } : {};
}

/* Lays the capabilities one provider learned over another's, in place, since a host may hold the object itself. */
function copyCapabilities(target: ChatProvider, source: ChatProvider): void {
    const capabilities = target.capabilities as unknown as Record<string, unknown>;
    for (const key of Object.keys(capabilities)) {
        delete capabilities[key];
    }
    Object.assign(capabilities, source.capabilities);
}

/*
 * Grok's login follows the launch's environment, so a chat runs on the provider of its login: the stored one or the key.
 * Both share the catalog and the store, and what either learns is laid over the listed one and told to its listeners.
 */
export function createGrokProvider(catalogStore?: AcpCatalogStore): ChatProvider {
    const catalog = agentDefaultCatalog();
    const listeners = new Set<() => void>();
    const byLogin = new Map<string, ChatProvider>();
    const notify = (): void => {
        for (const listener of [...listeners]) {
            listener();
        }
    };
    const learned = (source: ChatProvider): void => {
        if (source !== listed) {
            copyCapabilities(listed, source);
        }
        notify();
    };
    const forLogin = (authMethod: string): ChatProvider => {
        const known = byLogin.get(authMethod);
        if (known !== undefined) {
            return known;
        }
        const provider = createAcpProvider({ ...GROK_SPEC, catalog, authMethod, ...storing(catalogStore) });
        provider.onChange?.(() => learned(provider));
        byLogin.set(authMethod, provider);
        return provider;
    };
    const listed = forLogin(grokAuthMethod({}));
    return {
        ...listed,
        onChange: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        askAccount: async (command, env): Promise<AccountReading> => {
            const listed = await askGrokModels(command, env);
            // Signed out, Grok still lists models, which are not the account's.
            if (listed.signedIn && adoptGrokModels(catalog, catalogStore, listed)) {
                notify();
            }
            return { signedIn: listed.signedIn, email: null, plan: null, organization: null };
        },
        createBackend: (launch, host) => forLogin(grokAuthMethod(launch.env)).createBackend(launch, host)
    };
}

export const grokProvider: ChatProvider = createGrokProvider();

const COPILOT_ONE_SHOT = ['-s', '--no-ask-user', '--deny-tool=shell, write'];

const COPILOT_SPEC: AcpProviderSpec = {
    kind: 'copilot',
    name: 'GitHub Copilot',
    command: 'copilot',
    args: ['--acp', '--stdio', '--no-auto-update', COPILOT_ALLOW_CONTEXT],
    catalog: agentDefaultCatalog(),
    model: agentModel,
    modes: COPILOT_MODES,
    loginHint: 'Run `copilot login` in a terminal.',
    client: RUIMTE_ACP_CLIENT,
    capabilities: { terminal: true, hooks: true },
    autoAllow: allowsContextCommand,
    resumeCommand: 'copilot {flags} --resume={id}',
    install: {
        description: "GitHub's coding agent, in a terminal and in a chat.",
        commands: { darwin: 'npm install -g @github/copilot', linux: 'npm install -g @github/copilot', win32: 'npm install -g @github/copilot' },
        guideUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
        signIn: [
            { kind: 'command', command: 'copilot login' },
            { kind: 'env', variable: 'COPILOT_GITHUB_TOKEN' }
        ]
    },
    // `-s` prints only the answer; without shell and file writes it can only read. A prompt piped in runs the same way.
    oneShotArgs: (prompt) => ['--no-auto-update', '-p', prompt, ...COPILOT_ONE_SHOT],
    oneShotStdinArgs: ['--no-auto-update', ...COPILOT_ONE_SHOT],
    // `-p` answers and exits; `-i` runs the prompt and stays.
    firstPromptArgs: (prompt) => ['-i', prompt]
};

/* Where every Copilot turn's usage is logged: its CLI keeps no file the usage page can read. */
export function copilotUsageDirectory(home: string): string {
    return join(home, 'usage', 'copilot');
}

export function createCopilotProvider(catalogStore?: AcpCatalogStore, usageLog?: string): ChatProvider {
    return createAcpProvider({ ...COPILOT_SPEC, catalog: agentDefaultCatalog(), ...storing(catalogStore), ...(usageLog === undefined ? {} : { usageLog }) });
}

export const copilotProvider: ChatProvider = createCopilotProvider();

// Google's CLI, which a terminal starts and a single prompt goes to; the chat runs on a server of its own.
export const ANTIGRAVITY_CLI = 'agy';

/* Google's ACP server for Antigravity, pinned to the release the ACP registry lists (`antigravity-acp`). */
export const ANTIGRAVITY_ACP_RELEASE = parseAcpServerRelease(antigravityRelease);

/* The server's session modes (`default`, `auto_edit`, `yolo`); it has none between accepting edits and accepting everything. */
export const ANTIGRAVITY_MODES: AcpModeMap = {
    supervised: ['default'],
    'auto-accept-edits': ['auto_edit'],
    auto: ['auto_edit'],
    'full-access': ['yolo']
};

/*
 * The server keeps its sessions and its sign-in under `GEMINI_HOME` (`~/.gemini` without it), so an account is
 * a folder of its own there. It signs in through ACP `authenticate` in a chat, never from a terminal, so it has
 * no `loginCommand` and its accounts are offered as chat logins.
 */
const ANTIGRAVITY_HOME: ProviderHome = { env: 'GEMINI_HOME', fallback: '.gemini', loginEnv: [] };

const ANTIGRAVITY_SPEC: AcpProviderSpec = {
    kind: 'antigravity',
    name: 'Antigravity',
    // Only stands in until the server is installed; the terminal starts `agy` (`TERMINAL_EXECUTABLES` in `launch.ts`).
    command: ANTIGRAVITY_CLI,
    catalog: agentDefaultCatalog(),
    model: agentModel,
    modes: ANTIGRAVITY_MODES,
    // The server runs the browser sign-in itself, on a callback server of its own.
    authMethod: 'oauth-personal',
    loginHint: 'Sign in to Antigravity in the browser the chat opens.',
    client: RUIMTE_ACP_CLIENT,
    capabilities: { terminal: true, hooks: true },
    autoAllow: allowsContextCommand,
    resumeCommand: 'agy {flags} --conversation {id}',
    home: ANTIGRAVITY_HOME,
    // The CLI only; the chat's server is the step after it, installed from the Providers pane.
    install: {
        description: "Google's coding agent, in a terminal and in a chat.",
        commands: {
            darwin: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
            linux: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
            win32: 'irm https://antigravity.google/cli/install.ps1 | iex'
        },
        guideUrl: 'https://antigravity.google/docs/cli',
        // The first start of `agy` signs it in in the browser, and so does a chat's first turn.
        signIn: [{ kind: 'chat' }, { kind: 'command', command: 'agy' }]
    },
    // Antigravity CLI 1.4 reads a prompt only from `-p` (answers and exits), `-i` (runs it and stays) or stdin.
    firstPromptArgs: (prompt) => ['-i', prompt]
};

/*
 * A single prompt to `agy`, which is apart from the chat's server. Headless it soft-denies every call that would ask
 * (antigravity.google/docs/cli/headless), so it reads and answers.
 */
export function antigravityOneShotArgs(prompt: string): string[] {
    return ['-p', prompt, '--output-format', 'text'];
}

/*
 * Antigravity is installed once `agy` is, which is all its terminal needs. Its chat runs on the server a person
 * installed apart from it, so without one it offers no chat and starts none.
 */
export function createAntigravityProvider(server: AcpServerLaunch | null, catalogStore?: AcpCatalogStore): ChatProvider {
    const base = createAcpProvider({ ...ANTIGRAVITY_SPEC, catalog: agentDefaultCatalog(), ...storing(catalogStore) });
    return {
        ...base,
        get command() {
            return server?.launch() ?? base.command;
        },
        // `providerFor` has no server at hand, so it keeps what the CLI can do once one is there.
        get capabilities() {
            return server === null || server.launch() !== null ? base.capabilities : { ...base.capabilities, chat: false };
        },
        createBackend: (launch, host) => {
            if (server?.launch() == null) {
                throw new Error('Install the Antigravity server in Settings, Providers first.');
            }
            return base.createBackend(launch, host);
        }
    };
}
