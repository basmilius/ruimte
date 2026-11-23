import type { CodexClientInfo } from '@adecore/agents/chat';
import { antigravityUsageDirectory, copilotUsageDirectory, createClaudeProvider, createCodexProvider, type ChatProvider } from '@adecore/agents/providers';
import type { AgentKind } from '@ruimte/contracts';
import { withRuimteMcp } from '../ruimte-mcp.ts';
import { acpCatalogStore } from './acp-catalog-store.ts';
import { createAntigravityProvider, createCopilotProvider, createGrokProvider } from './acp-providers.ts';
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
        create: (context) =>
            createAntigravityProvider(catalogStoreOf(context, 'antigravity'), context.home === undefined ? undefined : antigravityUsageDirectory(context.home))
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
    nanogpt?: NanoGptService;
    claudeApi?: AnthropicClaudeApiService;
    commands?: ProviderCommands;
}

interface ProviderSet {
    providers: ChatProvider[];
    nanogpt: NanoGptService;
    claudeApi: AnthropicClaudeApiService;
}

/* Every row made once, in table order, with the services the API rows keep their key and models in. */
export function createProviders(options: ProviderTableOptions = {}): ProviderSet {
    const made = new Map<AgentKind, ChatProvider>();
    const nanogpt = options.nanogpt ?? new NanoGptService();
    let claudeApi = options.claudeApi;

    const context: ProviderContext = {
        home: options.home,
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

    return { providers, nanogpt, claudeApi: context.claudeApi };
}

let shipped: ChatProvider[] | null = null;

/* The providers as the table makes them on a machine of their own, for text that names their models before any registry exists. */
export function shippedProviders(): readonly ChatProvider[] {
    shipped ??= createProviders().providers;

    return shipped;
}

/*
 * Whether an agent of this CLI opens as a chat: what the CLI can do, not whether this machine's copy is new enough
 * now. A chat on a CLI below its floor still opens as one, and says to update it.
 */
export function opensAsChat(provider: ChatProvider): boolean {
    return (shippedProviders().find((shipped) => shipped.kind === provider.kind) ?? provider).capabilities.chat;
}
