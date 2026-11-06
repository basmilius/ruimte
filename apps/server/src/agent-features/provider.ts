import { providerActions } from '../actions/provider-actions.ts';
import { providerToolkit } from '../tools/provider-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const providerFeature = defineAgentFeature({
    name: 'provider',
    toolkit: providerToolkit,
    actions: providerActions,
    host: ({ providers, usage }) => ({
        providerInstalls: {
            catalog: (refresh) => providers.registryAgents.catalog(refresh),
            versions: (refresh) => providers.versions.list(refresh)
        },
        planLimits: { snapshot: () => usage.limits.snapshot(), now: Date.now }
    })
});
