import type { ProjectClosingResult } from '@ruimte/contracts';
import { create } from 'zustand';

/* The confirmation an agent's `project_close` raised, with what the machine said closing would end. */
interface AgentCloseAsk extends ProjectClosingResult {
    endpointId: string;
    projectId: string;
    name: string;
    agent: string;
}

export const useAgentCloseAsk = create<{ ask: AgentCloseAsk | null }>(() => ({ ask: null }));

/* The folder an agent's `project_open` asked to make a project; only the person's own open of it makes one. */
interface AgentFolderAsk {
    endpointId: string;
    folder: string;
    agent: string;
}

export const useAgentFolderAsk = create<{ ask: AgentFolderAsk | null }>(() => ({ ask: null }));
