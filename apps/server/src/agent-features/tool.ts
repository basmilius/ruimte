import { toolActions } from '../actions/tool-actions.ts';
import { toolToolkit } from '../tools/tool-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The tools extensions bring, which an agent lists and runs; absent on a host without extensions. */
        extensions?: {
            agentTools(): readonly { id: string; description: string; parameters: unknown }[];
            runAgentTool(id: string, input: unknown, context: { caller: string }): Promise<string>;
        };
    }
}

export const toolFeature = defineAgentFeature({
    name: 'tool',
    toolkit: toolToolkit,
    actions: toolActions,
    host: ({ extensions }) => ({ extensions })
});
