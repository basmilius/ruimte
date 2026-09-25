import { translate, type Dispatcher } from '../dispatcher.ts';
import type { ProjectStore } from '../projects/project-store.ts';

export const registerProjectHandlers = (dispatcher: Dispatcher, store: ProjectStore): void => {
    dispatcher.register('project.sidebar', () => translate(() => store.sidebar()));
    dispatcher.register('project.list', () => translate(async () => ({ projects: await store.list() })));

    dispatcher.register('project.open', (payload, client) =>
        translate(async () => {
            const opened = await store.openProject(payload);
            // Told after the open, so a client is only counted as watching a project it really got.
            store.hold(client.id, opened.summary.projectId);
            return opened;
        })
    );

    dispatcher.register('project.save', (payload, client) =>
        translate(async () => ({ rev: await store.save(payload.projectId, payload.baseRev, payload.content, payload.shared, client.id) }))
    );

    dispatcher.register('project.save-local', (payload) =>
        translate(async () => {
            await store.saveLocal(payload.projectId, payload.local);
            return {};
        })
    );

    /* The project id is the payload's, not this client's: closing a project a person is not looking
       at is the same act, and the daemon is the only one that knows who else still has it open. */
    dispatcher.register('project.close', (payload, client) => translate(() => store.closeProject(payload.projectId, client.id)));

    dispatcher.register('project.closing', (payload, client) => translate(() => store.closing(client.id, payload.projectId)));

    // Switching to another project on the same machine. The daemon lets go, but the list does not move.
    dispatcher.register('project.release', (payload, client) =>
        translate(() => {
            store.letGo(client.id, payload.projectId);
            return {};
        })
    );

    dispatcher.register('project.setIcon', (payload) => translate(async () => ({ summary: await store.setIcon(payload) })));

    dispatcher.register('project.setIdentity', (payload) => translate(async () => ({ summary: await store.setIdentity(payload) })));

    dispatcher.register('project.delete', (payload) =>
        translate(async () => {
            await store.delete(payload.projectId, payload.removeFiles);
            return {};
        })
    );
};
