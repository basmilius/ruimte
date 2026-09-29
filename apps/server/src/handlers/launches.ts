import { translate, type Dispatcher } from '../dispatcher.ts';
import type { LaunchRunner } from '../launches/runner.ts';
import type { LaunchStore } from '../launches/store.ts';

/* Every request here comes from a client, so it speaks for a person: a start may approve, a stop may force. */
export const registerLaunchHandlers = (dispatcher: Dispatcher, store: LaunchStore, runner: LaunchRunner): void => {
    dispatcher.register('launches.read', (payload) => translate(() => store.read(payload.projectId)));

    dispatcher.register('launches.save', (payload) => translate(async () => ({ rev: await store.save(payload.projectId, payload.baseRev, payload.launches) })));

    dispatcher.register('launch.start', (payload) =>
        translate(() => runner.start(payload.projectId, payload.launchId, { actor: 'person', approve: payload.approve, replace: payload.replace }))
    );

    dispatcher.register('launch.restart', (payload) =>
        translate(() => runner.restart(payload.projectId, payload.launchId, { actor: 'person', approve: payload.approve, replace: payload.replace }))
    );

    dispatcher.register('launch.stop', (payload) =>
        translate(async () => {
            await runner.stop(payload.projectId, payload.launchId, { force: payload.force });
            return {};
        })
    );

    dispatcher.register('launch.list', () => ({ launches: runner.list() }));
};
