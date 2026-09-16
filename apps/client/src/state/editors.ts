import type { StoreApi } from 'zustand';

/*
 * The editors of the open project that hold a single view each, by view id. A canvas and a drawing were
 * one store for the project, which is what kept it to one view on screen: the store was the
 * editor of whichever view was active and a switch wrote it back and loaded the next. A store per
 * view is what lets a grid of cells edit nine of them without any of them knowing the others exist.
 */
export interface EditorRegistry<T> {
    /*
     * The editor of no view at all. A project whose view on screen is a chat or a terminal has no
     * canvas to read, and this is what it reads instead: empty, one per registry, never saved.
     */
    readonly blank: StoreApi<T>;
    /* The editor of a view on screen, made the first time it is asked for. */
    of(viewId: string): StoreApi<T>;
    /* The editor of a view only when it is on screen; a view nobody opened has none. */
    peek(viewId: string): StoreApi<T> | null;
    /* Every editor that is alive, in the order they opened, which is what a save walks over. */
    live(): [string, StoreApi<T>][];
    release(viewId: string): void;
    /* Everything outside this list is released, which is what a layout change comes down to. */
    keep(viewIds: readonly string[]): void;
    /* Every change in every live editor, named by the view it happened in. */
    subscribe(listener: (viewId: string, state: T, previous: T) => void): () => void;

    /*
     * Which of these editors the keyboard is in. It is the view of the focused cell, mirrored here by
     * the document store, so a reader can resolve "the canvas in front of me" from the registry alone
     * rather than having to hold the document store as well.
     */
    focused(): string | null;
    focus(viewId: string | null): void;
    /* Which editors there are and which one has the focus, never what is inside them. */
    subscribeShape(listener: () => void): () => void;
}

/*
 * A registry over the store factory of one editor. It owns the subscriptions of what it made, so a
 * reader subscribes once here instead of rewiring itself every time a cell opens or closes.
 */
export const createEditorRegistry = <T>(create: () => StoreApi<T>, blank: StoreApi<T> = create()): EditorRegistry<T> => {
    const editors = new Map<string, StoreApi<T>>();
    const offs = new Map<string, () => void>();
    const listeners = new Set<(viewId: string, state: T, previous: T) => void>();
    const shapeListeners = new Set<() => void>();
    let focused: string | null = null;

    const announce = (): void => {
        for (const listener of [...shapeListeners]) {
            listener();
        }
    };

    const release = (viewId: string): void => {
        if (!editors.has(viewId)) {
            return;
        }
        offs.get(viewId)?.();
        offs.delete(viewId);
        editors.delete(viewId);
        announce();
    };

    return {
        blank,

        of(viewId) {
            const known = editors.get(viewId);
            if (known) {
                return known;
            }
            const store = create();
            editors.set(viewId, store);
            offs.set(
                viewId,
                store.subscribe((state, previous) => {
                    for (const listener of listeners) {
                        listener(viewId, state, previous);
                    }
                })
            );
            announce();
            return store;
        },

        peek: (viewId) => editors.get(viewId) ?? null,

        live: () => [...editors.entries()],

        release,

        keep(viewIds) {
            const kept = new Set(viewIds);
            for (const viewId of [...editors.keys()]) {
                if (!kept.has(viewId)) {
                    release(viewId);
                }
            }
        },

        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },

        focused: () => focused,

        focus(viewId) {
            if (focused === viewId) {
                return;
            }
            focused = viewId;
            announce();
        },

        subscribeShape(listener) {
            shapeListeners.add(listener);
            return () => {
                shapeListeners.delete(listener);
            };
        }
    };
};
