import type { ProviderInfo } from '@ruimte/contracts';
import type { AgentTarget } from './nodes';

export function availableAgents(providers: readonly ProviderInfo[], target: AgentTarget): ProviderInfo[] {
    return providers.filter((provider) => provider.installed && provider.capabilities[target]);
}
