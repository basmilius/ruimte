import { AgentKindSchema, type AgentKind } from '@ruimte/contracts';

/* Which agent answers an inline edit; a null model is that CLI's own default. */
export interface InlineEditAgent {
    provider: AgentKind;
    model: string | null;
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
        model: typeof pick.model === 'string' && pick.model !== '' ? pick.model : null
    };
}

export function agentChangesModeFrom(stored: unknown): AgentChangesMode {
    return AGENT_CHANGES_MODES.find((mode) => mode === stored) ?? DEFAULT_AGENT_CHANGES_MODE;
}
