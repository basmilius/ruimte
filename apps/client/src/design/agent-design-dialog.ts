import { createDialogState } from '@/registry/dialog-state';

/* A hidden design agent's design as it opens over the window: the agent, whose chat id is its design's id, and its folder, absolute. */
export interface AgentDesign {
    endpointId: string;
    agentId: string;
    title: string;
    folder: string;
    /* What a watch must cover to see the folder come, the project folder. */
    watched: string;
    /* The task row the design was opened from, whose card gets the focus back once it closes. */
    taskId: string;
}

/* A look at the agent's work rather than a place, like a sub-agent's conversation: one window's, never saved. */
export const agentDesignDialog = createDialogState<AgentDesign>();
