import type { CodexClientInfo } from '@adecore/agents/chat';
import { copilotUsageDirectory, createClaudeProvider, createCodexProvider, type AcpServerLaunch, type ChatProvider } from '@adecore/agents/providers';
import type { AgentKind } from '@ruimte/contracts';
import { withRuimteMcp } from '../ruimte-mcp.ts';
import { acpCatalogStore } from './acp-catalog-store.ts';
import { ANTIGRAVITY_ACP_RELEASE, createAntigravityProvider, createCopilotProvider, createGrokProvider } from './acp-providers.ts';
import { AcpServerInstall, type AcpServerRelease } from './acp-server.ts';
import { createAnthropicClaudeApiProvider } from './anthropic-claude-api-provider.ts';
import { AnthropicClaudeApiService } from './anthropic-claude-api-service.ts';
import { createNanoGptProvider } from './nanogpt-provider.ts';
import { NanoGptService } from './nanogpt-service.ts';

// How the daemon names itself to every Codex app-server it opens.
const RUIMTE_CODEX_CLIENT: CodexClientInfo = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

/* What a row builds its provider from. A row asks for the provider of an earlier one by its kind. */
interface ProviderContext {
    // Where the ACP agents keep what they reported across a restart; absent keeps it in memory only.
    readonly home: string | undefined;
    // The chat server of a CLI that comes apart from it, once a person installed it; null while there is none to launch.
    server(kind: AgentKind): AcpServerLaunch | null;
    readonly nanogpt: NanoGptService;
    readonly claudeApi: AnthropicClaudeApiService;
    // What starts a CLI when it is not the one on the path (a test's fake), and how Codex's `--help` is read.
    readonly commands: ProviderCommands;
    provider(kind: AgentKind): ChatProvider;
}

export interface ProviderCommands {
    claude?: string[];
    codex?: string[];
    codexHelp?: (executable: string) => Promise<string>;
}

interface ProviderRow {
    readonly kind: AgentKind;
    // Whether the address book keeps a model catalog for this CLI.
    readonly modelFeed?: true;
    // The release of the chat server this CLI runs its chat on, when that is installed apart from the CLI.
    readonly server?: AcpServerRelease;
    create(context: ProviderContext): ChatProvider;
}

/*
 * The agent CLIs this daemon offers, then the API providers, in the order every menu lists them. A new CLI is one
 * provider file and one row here: the registry, the model feed and the tool texts all derive from this table.
 */
const ROWS: readonly ProviderRow[] = [
    {
        kind: 'claude',
        modelFeed: true,
        create: ({ commands }) => createClaudeProvider({ launch: withRuimteMcp, ...(commands.claude ? { command: commands.claude } : {}) })
    },
    {
        kind: 'codex',
        modelFeed: true,
        create: ({ commands }) =>
            createCodexProvider({
                client: RUIMTE_CODEX_CLIENT,
                launch: withRuimteMcp,
                ...(commands.codex ? { command: commands.codex } : {}),
                ...(commands.codexHelp ? { help: commands.codexHelp } : {})
            })
    },
    {
        kind: 'antigravity',
        modelFeed: true,
        server: ANTIGRAVITY_ACP_RELEASE,
        create: (context) => createAntigravityProvider(context.server('antigravity'), catalogStoreOf(context, 'antigravity'))
    },
    {
        kind: 'copilot',
        modelFeed: true,
        create: (context) =>
            createCopilotProvider(catalogStoreOf(context, 'copilot'), context.home === undefined ? undefined : copilotUsageDirectory(context.home))
    },
    { kind: 'grok', modelFeed: true, create: (context) => createGrokProvider(catalogStoreOf(context, 'grok')) },
    { kind: 'nanogpt', create: (context) => createNanoGptProvider(context.nanogpt) },
    { kind: 'anthropic-claude-api', create: (context) => createAnthropicClaudeApiProvider(context.claudeApi, context.provider('claude')) }
];

function catalogStoreOf(context: ProviderContext, kind: AgentKind) {
    return context.home === undefined ? undefined : acpCatalogStore(context.home, kind);
}

export function tableKinds(): AgentKind[] {
    return ROWS.map((row) => row.kind);
}

/* Whether this daemon ships this kind; a node may still name one it dropped (`gemini`) or never knew. */
export function offersKind(kind: string): boolean {
    return ROWS.some((row) => row.kind === kind);
}

export function modelFeedKinds(): AgentKind[] {
    return ROWS.filter((row) => row.modelFeed === true).map((row) => row.kind);
}

interface ProviderTableOptions {
    home?: string;
    // Stands in for the chat server a person installed, as a test's.
    serverLaunches?: Partial<Record<AgentKind, AcpServerLaunch>>;
    nanogpt?: NanoGptService;
    claudeApi?: AnthropicClaudeApiService;
    commands?: ProviderCommands;
}

interface ProviderSet {
    providers: ChatProvider[];
    // The chat servers a person installs apart from their CLI, with the release each one is pinned to; only with a home to install into.
    servers: Map<AgentKind, { install: AcpServerInstall; release: AcpServerRelease }>;
    nanogpt: NanoGptService;
    claudeApi: AnthropicClaudeApiService;
}

/* Every row made once, in table order, with the services the API rows keep their key and models in. */
export function createProviders(options: ProviderTableOptions = {}): ProviderSet {
    const made = new Map<AgentKind, ChatProvider>();
    const nanogpt = options.nanogpt ?? new NanoGptService();
    const servers = new Map<AgentKind, { install: AcpServerInstall; release: AcpServerRelease }>();

    for (const row of ROWS) {
        if (row.server !== undefined && options.home !== undefined) {
            servers.set(row.kind, { install: new AcpServerInstall({ provider: row.kind, home: options.home, release: row.server }), release: row.server });
        }
    }

    let claudeApi = options.claudeApi;

    const context: ProviderContext = {
        home: options.home,
        server: (kind) => options.serverLaunches?.[kind] ?? servers.get(kind)?.install ?? null,
        commands: options.commands ?? {},
        nanogpt,
        get claudeApi() {
            // Its options come from Claude Code's catalog, so it is made once that provider is.
            claudeApi ??= new AnthropicClaudeApiService(fetch, context.provider('claude').catalog);

            return claudeApi;
        },
        provider: (kind) => {
            const known = made.get(kind);

            if (known !== undefined) {
                return known;
            }

            const row = ROWS.find((candidate) => candidate.kind === kind);

            if (row === undefined) {
                throw new Error(`No provider row for ${kind}`);
            }

            const provider = row.create(context);
            made.set(kind, provider);

            return provider;
        }
    };

    const providers = ROWS.map((row) => context.provider(row.kind));

    return { providers, servers, nanogpt, claudeApi: context.claudeApi };
}

let shipped: ChatProvider[] | null = null;

/* The providers as the table makes them on a machine of their own, for text that names their models before any registry exists. */
export function shippedProviders(): readonly ChatProvider[] {
    shipped ??= createProviders().providers;

    return shipped;
}
