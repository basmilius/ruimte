import prices from '@adecore/agents/usage/prices-snapshot.json' with { type: 'json' };
import { cheapestEditorModel, EDITOR_ASSIST_PROVIDERS, type ProviderInfo, AgentKindSchema, type AgentKind, type ProviderAccounts } from '@ruimte/contracts';
import { availableAgents } from '@/agents/creation';

/*
 * Which agent answers an inline edit, or which one is the editor model. A null model is the CLI's own
 * default for an inline edit and the cheapest available one for the editor model; no account is the CLI's default account.
 */
export interface InlineEditAgent {
    provider: AgentKind;
    model: string | null;
    account?: string;
}

export const DEFAULT_INLINE_EDIT_AGENT: InlineEditAgent = { provider: 'claude', model: null };

/* How an edit a running chat makes in an open file shows up in the editor. */
export const AGENT_CHANGES_MODES = ['off', 'gutter', 'review'] as const;

export type AgentChangesMode = (typeof AGENT_CHANGES_MODES)[number];

export const DEFAULT_AGENT_CHANGES_MODE: AgentChangesMode = 'gutter';

/* A stored pick that names no known CLI falls back to the default, and an unset model stays unset. */
export function inlineEditAgentFrom(stored: unknown): InlineEditAgent {
    const pick: Partial<Record<keyof InlineEditAgent, unknown>> = typeof stored === 'object' && stored !== null ? stored : {};
    const provider = AgentKindSchema.safeParse(pick.provider);
    return {
        provider: provider.success ? provider.data : DEFAULT_INLINE_EDIT_AGENT.provider,
        model: typeof pick.model === 'string' && pick.model !== '' ? pick.model : null,
        ...(typeof pick.account === 'string' && pick.account !== '' ? { account: pick.account } : {})
    };
}

/*
 * The account an edit runs under on a machine: the one the setting names while that machine still has
 * it, turned on and of the same CLI, and otherwise the CLI's default account. An id only means
 * something on the machine that made it, and a machine that has not answered yet has none to offer.
 */
export function inlineEditAccountOn(accounts: ProviderAccounts | null | undefined, provider: AgentKind, account: string | undefined): string | undefined {
    const entry = account === undefined ? undefined : accounts?.accounts[account];
    return account !== undefined && entry?.kind === provider && entry.enabled !== false ? account : undefined;
}

export function agentChangesModeFrom(stored: unknown): AgentChangesMode {
    return AGENT_CHANGES_MODES.find((mode) => mode === stored) ?? DEFAULT_AGENT_CHANGES_MODE;
}

/* Whether the editor asks the editor model for a continuation: never, or when a person presses the key. */
export const GHOST_TEXT_MODES = ['off', 'request'] as const;

export type GhostTextMode = (typeof GHOST_TEXT_MODES)[number];

export const DEFAULT_GHOST_TEXT_MODE: GhostTextMode = 'request';

export function ghostTextModeFrom(stored: unknown): GhostTextMode {
    return GHOST_TEXT_MODES.find((mode) => mode === stored) ?? DEFAULT_GHOST_TEXT_MODE;
}

/* The agent of an inline edit: the one the setting names while it is installed, else the first chat agent that is, on its CLI's own model. */
export function inlineEditAgentOn(providers: readonly ProviderInfo[], wanted: InlineEditAgent): InlineEditAgent {
    const offered = availableAgents(providers, 'chat');

    if (offered.length === 0 || offered.some((provider) => provider.kind === wanted.provider)) {
        return wanted;
    }

    return { provider: offered[0]!.kind, model: null };
}

/* An unset model follows the economy default; a concrete model remains the person's choice. */
export function editorAgentOn(providers: readonly ProviderInfo[], wanted: InlineEditAgent, capability: 'chat' | 'terminal' = 'chat'): InlineEditAgent {
    const offered = providers.filter((provider) => provider.installed && provider.capabilities[capability]);
    const owner = offered.find((provider) => provider.kind === wanted.provider);

    if (owner !== undefined) {
        return { ...wanted, model: wanted.model ?? cheapestEditorModel(owner.models, prices) };
    }

    const fallback = EDITOR_ASSIST_PROVIDERS.map((kind) => offered.find((provider) => provider.kind === kind)).find((provider) => provider !== undefined);

    return fallback === undefined ? wanted : { provider: fallback.kind, model: cheapestEditorModel(fallback.models, prices) };
}
