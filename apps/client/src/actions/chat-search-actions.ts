import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { refusing, type Requester } from '@/actions/refusal';
import { currentEndpointId } from '@/state/current-endpoint';
import { useProject } from '@/state/project';
import { machineFor } from '@/workspace/connections';

/* What the chat search reaches outside the document; a test hands in a fake. */
export interface ChatSearchMachine {
    transport(): Requester | null;
    projectId(): string | null;
}

const LIVE_MACHINE: ChatSearchMachine = {
    transport: () => machineFor(currentEndpointId())?.transport ?? null,
    projectId: () => useProject.getState().current?.projectId ?? null
};

export function chatSearchActions(overrides: Partial<ChatSearchMachine> = {}): ActionHandlers<void> {
    const machine: ChatSearchMachine = { ...LIVE_MACHINE, ...overrides };

    const reach = (): { transport: Requester; projectId: string } => {
        const transport = machine.transport();
        if (transport === null) {
            throw new ActionRefusal('no-machine', "This project's machine is not connected.");
        }
        const projectId = machine.projectId();
        if (projectId === null) {
            throw new ActionRefusal('no-project', 'Open a project to search its chats.');
        }
        return { transport, projectId };
    };

    return {
        'chat.search': async ({ query, searchId }) => {
            const { transport, projectId } = reach();
            return { output: await refusing(transport.request('chat.search', { projectId, query, searchId })) };
        },
        'chat.external': async () => {
            const { transport, projectId } = reach();
            return { output: await refusing(transport.request('chat.external', { projectId })) };
        }
    };
}
