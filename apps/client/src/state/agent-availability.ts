import { pickerGroupsOf, providerGroupOf, type AgentKind, type ProviderInfo } from '@ruimte/contracts';

// The two kinds of node an agent CLI can live in; every menu offers a provider under one of them.
export type AgentTarget = 'chat' | 'terminal';

/* The providers in the order a picker lists them; a machine older than that order sends them in its own. */
export function inPickerOrder<T extends { kind: AgentKind; name: string }>(providers: readonly T[]): T[] {
    const groups = pickerGroupsOf(providers);
    return [...groups.frontier, ...groups.others, ...groups.api];
}

/* Whether a picker draws a separator between two providers next to each other in that order: where one group ends. */
export function separatesGroups(previous: AgentKind | undefined, kind: AgentKind): boolean {
    return previous !== undefined && providerGroupOf(previous) !== providerGroupOf(kind);
}

export function availableAgents(providers: readonly ProviderInfo[], target: AgentTarget): ProviderInfo[] {
    return inPickerOrder(providers.filter((provider) => provider.installed && provider.capabilities[target]));
}

/* Where an agent picks up: a CLI session handed on from another chat or terminal, the folder it works in and the account it ran under. */
export interface AgentSession {
    resume?: string;
    cwd?: string;
    account?: string;
}
