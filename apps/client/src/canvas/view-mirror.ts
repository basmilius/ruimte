import { useEffect } from 'react';
import { create } from 'zustand';
import { currentEndpointId, dropEndpoint, endpointKey, patchIn, useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { transportFor } from '@/transport';
import type { Transport } from '@/transport/transport';

/* What one node shows of the view it points at. `snapshot` is null until the file has been read. */
export interface ViewMirror<TSnapshot> {
    snapshot: TSnapshot | null;
    /* The view this node points at is not a view of this project any more. */
    gone: boolean;
    loading: boolean;
}

interface MirrorState<TSnapshot> {
    /* Keyed with `endpointKey` over the view id: a view belongs to a project on one machine. */
    byKey: Record<string, ViewMirror<TSnapshot>>;
}

/* Everything one kind of mirrored view knows how to do that another kind does differently. */
export interface ViewMirrorKind<TSnapshot> {
    /*
     * Every change to what an editor of this kind shows. Every cell is listened to rather than the
     * one with the focus: a node mirrors a view that may be standing in the cell beside it, and an
     * edit there counts the same. An editor emptied on its way off screen is not the view becoming
     * empty, so a kind only reports a change its editor really holds.
     */
    subscribeSnapshots(listener: (viewId: string, snapshot: TSnapshot) => void): () => void;
    /* What the editor of this view holds right now, with its unsaved edits, or null when none has it. */
    liveSnapshot(viewId: string): TSnapshot | null;
    /* Reads the view from a machine. */
    open(link: Transport, projectId: string, viewId: string): Promise<TSnapshot>;
    /* The writes of an agent, another client or an editor on disk. */
    onChanged(link: Transport, listener: (viewId: string, snapshot: TSnapshot) => void): void;
}

export interface ViewMirrorHook<TSnapshot> {
    (viewId: string | null): ViewMirror<TSnapshot> | null;
}

/*
 * What a node that points at a view shows: read once and kept up to date by the daemon's watcher and
 * by the editor while that same view is open. A node is a mirror, never an editor, so nothing here
 * writes; two nodes and the view itself always show the same thing.
 */
export const createViewMirror = <TSnapshot>(kind: ViewMirrorKind<TSnapshot>): ViewMirrorHook<TSnapshot> => {
    const useMirrors = create<MirrorState<TSnapshot>>(() => ({ byKey: {} }));
    const empty: ViewMirror<TSnapshot> = { snapshot: null, gone: false, loading: false };

    const put = (key: string, patch: Partial<ViewMirror<TSnapshot>>): void => {
        useMirrors.setState((state) => ({ byKey: patchIn(state.byKey, key, empty, patch) }));
    };

    const watchers = new Map<string, number>();
    /* The socket each machine's change listener sits on; a socket that was replaced needs a new one. */
    const wired = new Map<string, Transport>();
    let wiredStores = false;

    const wireStores = (): void => {
        if (wiredStores) {
            return;
        }
        wiredStores = true;
        kind.subscribeSnapshots((viewId, snapshot) => {
            const key = endpointKey(currentEndpointId(), viewId);
            if (watchers.has(key)) {
                put(key, { snapshot, gone: false, loading: false });
            }
        });
        useProject.subscribe((state, previous) => {
            // Another project has other views; whatever was mirrored belongs to the one that left.
            if (state.current?.projectId !== previous.current?.projectId) {
                const endpointId = currentEndpointId();
                useMirrors.setState((mirrors) => ({ byKey: dropEndpoint(mirrors.byKey, endpointId) }));
            }
        });
    };

    const wireEndpoint = (endpointId: string): void => {
        const link = transportFor(endpointId);
        if (!link || wired.get(endpointId) === link) {
            return;
        }
        wired.set(endpointId, link);
        kind.onChanged(link, (viewId, snapshot) => {
            const key = endpointKey(endpointId, viewId);
            if (watchers.has(key)) {
                put(key, { snapshot, gone: false, loading: false });
            }
        });
    };

    const load = (endpointId: string, viewId: string): void => {
        const projectId = useProject.getState().current?.projectId;
        const link = transportFor(endpointId);
        if (!projectId || !link) {
            return;
        }
        const key = endpointKey(endpointId, viewId);
        // A view already open in a cell is in that editor, with the edits it has not saved yet.
        const editor = kind.liveSnapshot(viewId);
        if (editor !== null) {
            put(key, { snapshot: editor, gone: false, loading: false });
            return;
        }
        put(key, { loading: true });
        void kind
            .open(link, projectId, viewId)
            .then((snapshot) => put(key, { snapshot, gone: false, loading: false }))
            .catch(() => put(key, { snapshot: null, gone: true, loading: false }));
    };

    /* What one node shows, kept while the node is on screen. Nothing is closed: the editor owns that. */
    return (viewId) => {
        const endpointId = useEndpointId();
        const key = viewId ? endpointKey(endpointId, viewId) : null;

        useEffect(() => {
            if (!viewId || !key) {
                return;
            }
            wireStores();
            wireEndpoint(endpointId);
            watchers.set(key, (watchers.get(key) ?? 0) + 1);
            if (!useMirrors.getState().byKey[key]) {
                load(endpointId, viewId);
            }
            return () => {
                const left = (watchers.get(key) ?? 1) - 1;
                if (left > 0) {
                    watchers.set(key, left);
                    return;
                }
                watchers.delete(key);
            };
        }, [endpointId, key, viewId]);

        return useMirrors((state) => (key ? (state.byKey[key] ?? null) : null));
    };
};
