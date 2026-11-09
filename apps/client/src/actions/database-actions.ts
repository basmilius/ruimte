import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { refusing, type Requester } from '@/actions/refusal';
import { windowWorkspace } from '@/workspace/window';

/* What the database actions reach outside the document; a test hands in a fake. */
export interface DatabaseMachine {
    transport(): Requester | null;
}

const LIVE_MACHINE: DatabaseMachine = {
    transport: () => windowWorkspace()?.connection.transport ?? null
};

export function databaseActions(overrides: Partial<DatabaseMachine> = {}): ActionHandlers<void> {
    const machine: DatabaseMachine = { ...LIVE_MACHINE, ...overrides };
    return {
        'database.request': async ({ request }) => {
            const transport = machine.transport();
            if (transport === null) {
                throw new ActionRefusal('offline', 'The machine of this project is not connected.');
            }
            return { output: { response: await refusing(transport.request('database.request', request)) } };
        }
    };
}
