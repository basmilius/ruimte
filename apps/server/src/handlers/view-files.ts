import { translate } from '../dispatcher.ts';

/* The part of a view file store a request reaches; the store has more, and none of it is on the wire. */
interface ViewFileRequests<TDocument, TContent> {
    open(projectId: string, viewId: string): Promise<TDocument>;
    save(projectId: string, viewId: string, baseRev: number, content: TContent): Promise<number>;
    close(projectId: string, viewId: string): void;
    copy(projectId: string, from: string, to: string): Promise<void>;
}

interface ViewRef {
    projectId: string;
    viewId: string;
}

/*
 * What a drawing request and the same diagram request do, which is the same thing under two names.
 * The names stay with the caller. `REQUEST_SCHEMAS` types every payload and every result on its own,
 * and a handler that took the name as an argument could only satisfy that table by casting past it.
 */
export const viewFileHandlers = <TDocument, TContent>(store: ViewFileRequests<TDocument, TContent>) => {
    return {
        /* The scene, already drawn, for a client with no renderer of its own; it paints the result, not the document. */
        scene: <TScene>(payload: ViewRef, render: (document: TDocument) => TScene): Promise<TScene> =>
            translate(async () => render(await store.open(payload.projectId, payload.viewId))),

        open: (payload: ViewRef): Promise<{ document: TDocument }> =>
            translate(async () => ({ document: await store.open(payload.projectId, payload.viewId) })),

        save: (payload: ViewRef & { baseRev: number; content: TContent }): Promise<{ rev: number }> =>
            translate(async () => ({ rev: await store.save(payload.projectId, payload.viewId, payload.baseRev, payload.content) })),

        close: (payload: ViewRef): Promise<Record<string, never>> =>
            translate(() => {
                store.close(payload.projectId, payload.viewId);
                return {};
            }),

        copy: (payload: { projectId: string; from: string; to: string }): Promise<Record<string, never>> =>
            translate(async () => {
                await store.copy(payload.projectId, payload.from, payload.to);
                return {};
            })
    };
};
