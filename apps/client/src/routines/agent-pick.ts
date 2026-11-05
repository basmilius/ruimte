import { defaultProvider, readChatPreferences, startingSelection } from '@adecore/agents-react/chat';
import { useProviders } from '@adecore/agents-react/state';
import type { AgentKind, ModelSelection } from '@ruimte/contracts';
import { availableAgents } from '@/state/agent-availability';

export type AgentPick = { provider: AgentKind; selection: ModelSelection | undefined };

/* The name a routine gets from its prompt or command while a person gave it none. */
export function firstLine(text: string): string {
    return (text.trim().split(/[.\n]/)[0] ?? '').trim().slice(0, 60);
}

/* The agents a routine can run here, and the one it runs: what a person picked, else the one a new chat would start with. */
export function useAgentPick(pick: AgentPick | null) {
    const providers = useProviders((s) => s.providers);
    const pickable = availableAgents(providers, 'chat');
    const preferences = readChatPreferences();
    const provider = pick?.provider ?? pickable.find((entry) => entry.kind === defaultProvider(preferences))?.kind ?? pickable[0]?.kind ?? null;
    const providerInfo = pickable.find((entry) => entry.kind === provider);
    const selection = pick?.selection ?? (providerInfo ? (startingSelection(preferences, providerInfo) ?? undefined) : undefined);
    return { pickable, provider, selection };
}
