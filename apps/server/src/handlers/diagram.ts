import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { DiagramError, type DiagramStore } from '../projects/diagram-store.ts';

const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof DiagramError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });

export const registerDiagramHandlers = (dispatcher: Dispatcher, store: DiagramStore): void => {
    dispatcher.register('diagram.open', (payload) => translate(async () => ({ document: await store.open(payload.projectId, payload.viewId) })));

    dispatcher.register('diagram.save', (payload) =>
        translate(async () => ({ rev: await store.save(payload.projectId, payload.viewId, payload.baseRev, payload.content) }))
    );

    dispatcher.register('diagram.close', (payload) =>
        translate(() => {
            store.close(payload.projectId, payload.viewId);
            return {};
        })
    );

    dispatcher.register('diagram.copy', (payload) =>
        translate(async () => {
            await store.copy(payload.projectId, payload.from, payload.to);
            return {};
        })
    );
};
