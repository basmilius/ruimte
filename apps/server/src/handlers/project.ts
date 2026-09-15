import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { ProjectError, type ProjectStore } from '../projects/project-store.ts';

const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof ProjectError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });

export const registerProjectHandlers = (dispatcher: Dispatcher, store: ProjectStore): void => {
    dispatcher.register('project.list', () => translate(async () => ({ projects: await store.list() })));

    dispatcher.register('project.open', (payload, client) =>
        translate(async () => {
            const opened = await store.openProject(payload);
            // Told after the open, so a client is only counted as watching a project it really got.
            store.addViewer(client.id, opened.summary.projectId);
            return opened;
        })
    );

    dispatcher.register('project.save', (payload, client) =>
        translate(async () => ({ rev: await store.save(payload.projectId, payload.baseRev, payload.content, client.id) }))
    );

    dispatcher.register('project.save-local', (payload) =>
        translate(async () => {
            await store.saveLocal(payload.projectId, payload.local);
            return {};
        })
    );

    dispatcher.register('project.close', (payload, client) =>
        translate(async () => {
            store.removeViewer(client.id, payload.projectId);
            await store.closeProject(payload.projectId);
            return {};
        })
    );

    // Switching to another project on the same machine: the daemon lets go, the list does not move.
    dispatcher.register('project.release', (payload, client) =>
        translate(() => {
            store.removeViewer(client.id, payload.projectId);
            store.release(payload.projectId);
            return {};
        })
    );

    dispatcher.register('project.setIcon', (payload) => translate(async () => ({ summary: await store.setIcon(payload) })));

    dispatcher.register('project.delete', (payload) =>
        translate(async () => {
            await store.delete(payload.projectId, payload.removeFiles);
            return {};
        })
    );
};
