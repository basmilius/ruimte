import type { Area } from '../area.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { LaunchRunner } from '../launches/runner.ts';
import type { LaunchStore } from '../launches/store.ts';

export interface LaunchesDeps {
    store: LaunchStore;
    runner: LaunchRunner;
}

/* Every request here comes from a client, so it speaks for a person: a start may approve, a stop may force. */
export function launchesArea(deps: LaunchesDeps): Area {
    const { store, runner } = deps;

    return {
        name: 'launches',
        sources: [store, runner],
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        stop: [
            { phase: 'end', label: 'Closing launches', run: () => runner.close() },
            { phase: 'end', label: 'Closing launch files', run: () => store.closeAll() }
        ]
    };
}

function registerRequests(dispatcher: Dispatcher, { store, runner }: LaunchesDeps): void {
    dispatcher.register('launches.read', (payload) => store.read(payload.projectId));

    dispatcher.register('launches.save', async (payload) => ({
        rev: await store.save(payload.projectId, payload.baseRev, payload.launches, payload.imported)
    }));

    dispatcher.register('launches.detect', async (payload) => ({ suggestions: await store.detect(payload.projectId, payload.sources) }));

    dispatcher.register('launches.afterSettle', async (payload) => {
        await store.chooseAfterSettle(payload.projectId, payload.launchId);
        return {};
    });

    dispatcher.register('launch.start', (payload) =>
        runner.start(payload.projectId, payload.launchId, { actor: 'person', approve: payload.approve, replace: payload.replace })
    );

    dispatcher.register('launch.restart', (payload) =>
        runner.restart(payload.projectId, payload.launchId, { actor: 'person', approve: payload.approve, replace: payload.replace })
    );

    dispatcher.register('launch.stop', async (payload) => {
        await runner.stop(payload.projectId, payload.launchId, { force: payload.force });
        return {};
    });

    dispatcher.register('launch.list', () => ({ launches: runner.list() }));
}
