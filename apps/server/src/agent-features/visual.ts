import type { ProjectView } from '@ruimte/contracts';
import { visualActions } from '../actions/visual-actions.ts';
import { visualToolkit } from '../tools/visual-tools.ts';
import { agentVisuals, type VisualHost } from '../visuals/agent-host.ts';
import { defineAgentFeature } from './feature.ts';

/* The designs of a project as its document has them, which `visual_preview` builds a design page from. */
interface DesignHost {
    sides(projectId: string): Promise<{ views: readonly ProjectView[]; shared: readonly string[] }>;
}

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The pages the caller's own chat shows above its replies; absent on a host that keeps none. */
        visuals?: VisualHost;
        /* The designs of a project; absent on a host that reads none. */
        designs?: DesignHost;
    }
}

export const visualFeature = defineAgentFeature({
    name: 'visual',
    toolkit: visualToolkit,
    actions: visualActions,
    host: ({ identity, agents, devices, projects }) => ({
        visuals: agentVisuals({ enabled: () => identity.visualReplies, visuals: agents.visuals, chats: agents.chats, renderer: devices.visualRenderer }),
        designs: {
            sides: async (projectId) => {
                const { views, shared } = await projects.store.place(projectId);

                return { views, shared };
            }
        }
    })
});
