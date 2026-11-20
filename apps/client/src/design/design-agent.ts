import { useEffect } from 'react';
import { create } from 'zustand';
import { agentDesignDialog, type AgentDesign } from '@/design/agent-design-dialog';
import { listDesignFolder } from '@/design/design-read';
import { useDesignChat } from '@/state/design-chat';
import { endpointKey } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';
import { orNull } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';

interface DesignAgentStore {
    /* The folder of each agent asked about, by `endpointKey`; null for an agent that makes no design. An agent's folder never changes. */
    folders: Readonly<Record<string, string | null>>;
    keep(key: string, folder: string | null): void;
}

export const useDesignAgents = create<DesignAgentStore>((set) => ({
    folders: {},
    keep: (key, folder) => set((state) => ({ folders: { ...state.folders, [key]: folder } }))
}));

const asking = new Set<string>();

/*
 * The folder of a task's child when it is a hidden design agent, absolute; null for any other child, for a
 * machine from before design agents, and while the machine has not answered.
 */
export function useDesignAgentFolder(endpointId: string, projectId: string | null, childId: string | undefined): string | null {
    const answers = useMachineAnswers(endpointId, 'design.agent');
    const key = childId === undefined ? null : endpointKey(endpointId, childId);
    // Undefined while nobody asked yet.
    const folder = useDesignAgents((state) => (key === null ? null : state.folders[key]));
    const known = folder !== undefined;

    useEffect(() => {
        if (!answers || key === null || known || projectId === null || childId === undefined || asking.has(key)) {
            return;
        }

        asking.add(key);

        // A failed ask is asked again the next time the row draws; the row stays a plain row meanwhile.
        void orNull('design.agent', machineTransport(endpointId).request('design.agent', { projectId, agentId: childId })).then((answer) => {
            asking.delete(key);

            if (answer !== null) {
                useDesignAgents.getState().keep(key, answer.folder);
            }
        });
    }, [answers, key, known, projectId, childId, endpointId]);

    return answers ? (folder ?? null) : null;
}

/* The "Open design" button of the card of this task, which the keyboard goes back to once the design closes. */
export function openDesignButton(taskId: string): HTMLElement | null {
    const card = [...document.querySelectorAll<HTMLElement>('[data-design-card]')].find((candidate) => candidate.dataset.designCard === taskId);

    return card?.querySelector<HTMLElement>('[data-open-design]') ?? null;
}

/*
 * Opens the design of a hidden design agent over the window, on `page`, which `picked` says a person picked
 * themselves. A folder that is gone by now says so in a toast instead, and opens nothing.
 */
export async function openAgentDesign(design: AgentDesign, page: { file: string | null; picked: boolean }, goneText: string): Promise<void> {
    const read = await listDesignFolder(design.endpointId, design.folder);

    if (read.kind === 'missing') {
        useToasts.getState().show({ kind: 'error', title: goneText });

        return;
    }

    useDesignChat.getState().openAgentPage(design.agentId, page.file, page.picked);
    agentDesignDialog.open(design);
}
