import type { Dispatcher } from '../dispatcher.ts';
import type { RoutinesBundle } from '../wiring/routines.ts';

/* A client connection is always a person, so a save here counts as approval. None of these is on a peer's list; an agent has its tools. */
export function registerRoutineHandlers(dispatcher: Dispatcher, { routines, watchers, skills }: RoutinesBundle): void {
    dispatcher.register('routine.skills', (payload) => skills(payload));

    dispatcher.register('routine.list', ({ projectId }) => routines.list(projectId));

    dispatcher.register('routine.get', ({ projectId, routineId }) => routines.get(projectId, routineId));

    dispatcher.register('routine.save', ({ projectId, baseRev, routine, shared, account }) => routines.save(projectId, baseRev, routine, shared, account));

    dispatcher.register('routine.approve', async ({ projectId, routineId, digest }) => {
        await routines.approve(projectId, routineId, digest);
        return {};
    });

    dispatcher.register('routine.decline', async ({ projectId, routineId, digest }) => {
        await routines.decline(projectId, routineId, digest);
        return {};
    });

    dispatcher.register('routine.pause', async ({ projectId, routineId }) => {
        await routines.pause(projectId, routineId);
        return {};
    });

    dispatcher.register('routine.resume', async ({ projectId, routineId }) => {
        await routines.resume(projectId, routineId);
        return {};
    });

    dispatcher.register('routine.runNow', ({ projectId, routineId }) => routines.runNow(projectId, routineId));

    dispatcher.register('routine.remove', async ({ projectId, routineId, baseRev }) => {
        await routines.remove(projectId, baseRev, routineId);
        return {};
    });

    dispatcher.register('routine.watch', (_payload, client) => {
        // A channel that went while this was on its way would leave a watch nobody hears.
        if (client.closed !== true) {
            watchers.watch(client.id);
        }
        return {};
    });

    dispatcher.register('routine.unwatch', (_payload, client) => {
        watchers.unwatch(client.id);
        return {};
    });
}
