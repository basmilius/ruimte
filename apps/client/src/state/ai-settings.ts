import { AgentKindSchema, type AgentKind, type ProviderAccounts } from '@ruimte/contracts';

/* Which agent answers an inline edit; a null model is that CLI's own default, and no account is the CLI's default account. */
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

/* A stored pick that names no known CLI falls back to the default, and a model that is not text is the CLI's own. */
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
