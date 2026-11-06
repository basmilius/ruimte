import { visualActions } from '../actions/visual-actions.ts';
import { visualToolkit } from '../tools/visual-tools.ts';
import { agentVisuals, type VisualHost } from '../visuals/agent-host.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The pages the caller's own chat shows above its replies; absent on a host that keeps none. */
        visuals?: VisualHost;
    }
}

export const visualFeature = defineAgentFeature({
    name: 'visual',
    toolkit: visualToolkit,
    actions: visualActions,
    host: ({ identity, agents, devices }) => ({
        visuals: agentVisuals({ enabled: () => identity.visualReplies, visuals: agents.visuals, chats: agents.chats, renderer: devices.visualRenderer })
    })
});
