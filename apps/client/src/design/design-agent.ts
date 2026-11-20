import { useEffect } from 'react';
import { create } from 'zustand';
import { listDesignFolder } from '@/design/design-read';
import { useDesignChat, type AgentDesign } from '@/state/design-chat';
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

/* Gives the card the design was opened from the keyboard back once the chat's thread is in view again. */
function focusCard(taskId: string): void {
    requestAnimationFrame(() => {
        const card = [...document.querySelectorAll<HTMLElement>('[data-design-card]')].find((candidate) => candidate.dataset.designCard === taskId);

        card?.querySelector<HTMLElement>('[data-open-design]')?.focus();
    });
}

/* Closes the design a chat shows, and hands the keyboard back to its card. False when the chat showed none. */
export function closeAgentDesign(chatKey: string): boolean {
    const design = useDesignChat.getState().agentDesigns[chatKey];

    if (design === undefined || !useDesignChat.getState().closeAgentDesign(chatKey)) {
        return false;
    }

    focusCard(design.taskId);

    return true;
}

/*
 * Shows the design of a hidden design agent in the chat's place, on `page`, which `picked` says a person picked
 * themselves. A folder that is gone by now says so in a toast instead, and opens nothing.
 */
export async function openAgentDesign(
    endpointId: string,
    chatId: string,
    design: AgentDesign,
    page: { file: string | null; picked: boolean },
    goneText: string
): Promise<void> {
    const read = await listDesignFolder(endpointId, design.folder);

    if (read.kind === 'missing') {
        useToasts.getState().show({ kind: 'error', title: goneText });

        return;
    }

    useDesignChat.getState().openAgentDesign(endpointKey(endpointId, chatId), design, page.file, page.picked);
}
