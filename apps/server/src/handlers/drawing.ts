import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { DrawingError, type DrawingStore } from '../projects/drawing-store.ts';

const translate = <T>(work: () => T | Promise<T>): Promise<T> =>
    Promise.resolve()
        .then(work)
        .catch((e: unknown) => {
            if (e instanceof DrawingError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        });

export const registerDrawingHandlers = (dispatcher: Dispatcher, store: DrawingStore): void => {
    dispatcher.register('drawing.open', (payload) => translate(async () => ({ document: await store.open(payload.projectId, payload.viewId) })));

    dispatcher.register('drawing.save', (payload) =>
        translate(async () => ({ rev: await store.save(payload.projectId, payload.viewId, payload.baseRev, payload.content) }))
    );

    dispatcher.register('drawing.close', (payload) =>
        translate(() => {
            store.close(payload.projectId, payload.viewId);
            return {};
        })
    );

    dispatcher.register('drawing.copy', (payload) =>
        translate(async () => {
            await store.copy(payload.projectId, payload.from, payload.to);
            return {};
        })
    );
};
