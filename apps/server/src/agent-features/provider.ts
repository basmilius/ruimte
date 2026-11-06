import type { UsageLimitsSnapshot } from '@ruimte/contracts';
import { providerActions } from '../actions/provider-actions.ts';
import type { ProviderInstallHost } from '../providers/agent-host.ts';
import { providerToolkit } from '../tools/provider-tools.ts';
import { defineAgentFeature } from './feature.ts';

/* The plan windows the CLIs of this machine reported, as last read; a tool only reports them and never asks again. */
interface PlanLimitsHost {
    snapshot(): UsageLimitsSnapshot;
    now(): number;
}

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The ACP registry and the versions of the agent CLIs, which an agent reads and only a person installs from; absent on a host without them. */
        providerInstalls?: ProviderInstallHost;
        /* What the plans of this machine's accounts have left; absent on a host that reads none. */
        planLimits?: PlanLimitsHost;
    }
}

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
