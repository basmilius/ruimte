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

    dispatcher.register('project.open', (payload) => translate(() => store.openProject(payload)));

    dispatcher.register('project.save', (payload) => translate(async () => ({ rev: await store.save(payload.projectId, payload.baseRev, payload.content) })));

    dispatcher.register('project.save-local', (payload) =>
        translate(async () => {
            await store.saveLocal(payload.projectId, payload.local);
            return {};
        })
    );

    dispatcher.register('project.close', (payload) =>
        translate(() => {
            store.close(payload.projectId);
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
