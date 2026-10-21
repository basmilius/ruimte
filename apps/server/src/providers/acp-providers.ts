import type { AcpClientInfo, AcpModeMap, AcpPermissionRequest } from '@adecore/agents/chat';
import { ModelCatalog, createAcpProvider, isOnlyCommands, type AcpProviderSpec, type ChatProvider, type ProviderHome } from '@adecore/agents/providers';
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
    capabilities: { terminal: true },
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
    firstPromptArgs: (prompt) => [prompt]
};

/*
 * Grok's login follows the launch's environment, so each chat's backend comes from a provider made for it.
 * It shares the catalog, so the models a session reports still reach the picker.
 */
export function createGrokProvider(): ChatProvider {
    const spec: AcpProviderSpec = { ...GROK_SPEC, catalog: agentDefaultCatalog() };
    return {
        ...createAcpProvider(spec),
        createBackend: (launch, host) => createAcpProvider({ ...spec, authMethod: grokAuthMethod(launch.env) }).createBackend(launch, host)
    };
}

export const grokProvider: ChatProvider = createGrokProvider();

export const copilotProvider: ChatProvider = createAcpProvider({
    kind: 'copilot',
    name: 'GitHub Copilot',
    command: 'copilot',
    args: ['--acp', '--stdio', '--no-auto-update', COPILOT_ALLOW_CONTEXT],
    catalog: agentDefaultCatalog(),
    model: agentModel,
    modes: COPILOT_MODES,
    loginHint: 'Run `copilot login` in a terminal.',
    client: RUIMTE_ACP_CLIENT,
    capabilities: { terminal: true },
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
    // `-p` answers and exits; `-i` runs the prompt and stays.
    firstPromptArgs: (prompt) => ['-i', prompt]
});

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
    command: 'agy',
    catalog: agentDefaultCatalog(),
    model: agentModel,
    modes: ANTIGRAVITY_MODES,
    // The server runs the browser sign-in itself, on a callback server of its own.
    authMethod: 'oauth-personal',
    loginHint: 'Sign in to Antigravity in the browser the chat opens.',
    client: RUIMTE_ACP_CLIENT,
    capabilities: { terminal: true },
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

/* Antigravity's chat runs on the server a person installed; without one it is listed as not installed and starts nothing. */
export function createAntigravityProvider(server: AcpServerLaunch | null): ChatProvider {
    const base = createAcpProvider(ANTIGRAVITY_SPEC);
    return {
        ...base,
        get command() {
            return server?.launch() ?? base.command;
        },
        detect: () => Promise.resolve(server?.detection() ?? { installed: false, version: null }),
        createBackend: (launch, host) => {
            if (server?.launch() == null) {
                throw new Error('Install the Antigravity server in Settings, Providers first.');
            }
            return base.createBackend(launch, host);
        }
    };
}
