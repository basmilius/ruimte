import type { ClientConnection } from '../wire.ts';

/* The part of a view file store a request reaches; the store has more, and none of it is on the wire. */
interface ViewFileRequests<TDocument, TContent> {
    open(projectId: string, viewId: string): Promise<TDocument>;
    save(projectId: string, viewId: string, baseRev: number, content: TContent, origin?: string): Promise<number>;
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
export function viewFileHandlers<TDocument, TContent>(store: ViewFileRequests<TDocument, TContent>) {
    return {
        /* The scene, already drawn, for a client with no renderer of its own; it paints the result, not the document. */
        scene: async <TScene>(payload: ViewRef, render: (document: TDocument) => TScene): Promise<TScene> =>
            render(await store.open(payload.projectId, payload.viewId)),

        open: async (payload: ViewRef): Promise<{ document: TDocument }> => ({ document: await store.open(payload.projectId, payload.viewId) }),

        save: async (payload: ViewRef & { baseRev: number; content: TContent }, client: ClientConnection): Promise<{ rev: number }> => ({
            rev: await store.save(payload.projectId, payload.viewId, payload.baseRev, payload.content, client.id)
        }),

        close: (payload: ViewRef): Record<string, never> => {
            store.close(payload.projectId, payload.viewId);
            return {};
        },

        copy: async (payload: { projectId: string; from: string; to: string }): Promise<Record<string, never>> => {
            await store.copy(payload.projectId, payload.from, payload.to);
            return {};
        }
    };
}
