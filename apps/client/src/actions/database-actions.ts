import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { asRefusal } from '@/actions/developer-actions';
import { windowWorkspace } from '@/state/window';
import type { Transport } from '@/transport/transport';

type Requester = Pick<Transport, 'request'>;

/* What the database actions reach outside the document; a test hands in a fake. */
export interface DatabaseMachine {
    transport(): Requester | null;
}

const LIVE_MACHINE: DatabaseMachine = {
    transport: () => windowWorkspace()?.connection.transport ?? null
};

/* The database views of a person, through the machine of the project the window has open. */
export function databaseActions(overrides: Partial<DatabaseMachine> = {}): ActionHandlers<void> {
    const machine: DatabaseMachine = { ...LIVE_MACHINE, ...overrides };
    return {
        'database.request': async ({ request }) => {
            const transport = machine.transport();
            if (transport === null) {
                throw new ActionRefusal('offline', 'The machine of this project is not connected.');
            }
            try {
                return { output: { response: await transport.request('database.request', request) } };
            } catch (error: unknown) {
                throw asRefusal(error);
            }
        }
    };
}
