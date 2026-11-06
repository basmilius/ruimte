import { inPickerOrder, type ProviderInfo } from '@ruimte/contracts';

// The two kinds of node an agent CLI can live in; every menu offers a provider under one of them.
export type AgentTarget = 'chat' | 'terminal';

export function availableAgents(providers: readonly ProviderInfo[], target: AgentTarget): ProviderInfo[] {
    return inPickerOrder(providers.filter((provider) => provider.installed && provider.capabilities[target]));
}

/* Where an agent picks up: a CLI session handed on from another chat or terminal, the folder it works in and the account it ran under. */
export interface AgentSession {
    resume?: string;
    cwd?: string;
    account?: string;
}
