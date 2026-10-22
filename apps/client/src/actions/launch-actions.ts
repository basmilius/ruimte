import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { asRefusal } from '@/actions/developer-actions';
import { windowWorkspace } from '@/state/window';
import type { Transport } from '@/transport/transport';

type Requester = Pick<Transport, 'request'>;

/* What the launch actions reach outside the document; a test hands in a fake. */
export interface LaunchReach {
    transport(): Requester | null;
}

const LIVE_REACH: LaunchReach = {
    transport: () => windowWorkspace()?.connection.transport ?? null
};

/* A person's edits to the launches of a project. A save approves what it adds or changes, so it stays theirs. */
export function launchActions(overrides: Partial<LaunchReach> = {}): ActionHandlers<void> {
    const reach: LaunchReach = { ...LIVE_REACH, ...overrides };
    return {
        'launch.save': async ({ projectId, baseRev, launches, imported }) => {
            const transport = reach.transport();
            if (transport === null) {
                throw new ActionRefusal('no-machine', "This project's machine is not connected.");
            }
            try {
                return { output: await transport.request('launches.save', { projectId, baseRev, launches, imported }) };
            } catch (error: unknown) {
                throw asRefusal(error);
            }
        }
    };
}
