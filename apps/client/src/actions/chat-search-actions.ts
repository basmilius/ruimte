import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { asRefusal } from '@/actions/developer-actions';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { machineFor } from '@/transport/connections';
import type { Transport } from '@/transport/transport';

type Requester = Pick<Transport, 'request'>;

/* What the chat search reaches outside the document; a test hands in a fake. */
export interface ChatSearchMachine {
    transport(): Requester | null;
    projectId(): string | null;
}

const LIVE_MACHINE: ChatSearchMachine = {
    transport: () => machineFor(currentEndpointId())?.transport ?? null,
    projectId: () => useProject.getState().current?.projectId ?? null
};

/* A person's look through the chats of the open project, and through the CLI sessions started beside them. */
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
            try {
                return { output: await transport.request('chat.search', { projectId, query, searchId }) };
            } catch (error: unknown) {
                throw asRefusal(error);
            }
        },
        'chat.external': async () => {
            const { transport, projectId } = reach();
            try {
                return { output: await transport.request('chat.external', { projectId }) };
            } catch (error: unknown) {
                throw asRefusal(error);
            }
        }
    };
}
