import { contextActions } from '../actions/context-actions.ts';
import type { ContextHost } from '../context/agent-host.ts';
import { contextToolkit } from '../tools/context-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* What a person linked into a session, which `list` and `read` answer with. */
        context?: ContextHost;
    }
}

export const contextFeature = defineAgentFeature({
    name: 'context',
    toolkit: contextToolkit,
    actions: contextActions,
    host: ({ agents }) => ({ context: agents.context })
});
