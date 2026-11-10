import { launchActions } from '../actions/launch-actions.ts';
import type { LaunchHost } from '../launches/agent-host.ts';
import { launchToolkit } from '../tools/launch-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The launches of a project, as an agent may see and run them; absent on a host that runs none. */
        launches?: LaunchHost;
    }
}

export const launchFeature = defineAgentFeature({
    name: 'launch',
    toolkit: launchToolkit,
    actions: launchActions,
    host: ({ launches }) => ({ launches: launches.agentHost })
});
