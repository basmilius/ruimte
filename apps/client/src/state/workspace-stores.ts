import { createContext, useContext } from 'react';
import { useStore, type StoreApi } from 'zustand';
import type { CanvasState } from '@/state/canvas';
import type { DocumentState } from '@/state/document';
import type { DrawingState } from '@/state/drawing';
import type { ProjectState } from '@/state/project';

/*
 * The stores of one open project. They used to be four singletons, which is what made "one project
 * at a time" a fact of the client rather than a choice: a second project would have booted itself
 * into the same canvas. One set per workspace is what lets two machines' projects be edited side by
 * side. The types come in type-only, so nothing here imports a store at runtime and the store
 * modules can import this one.
 */
export interface WorkspaceStores {
    canvas: StoreApi<CanvasState>;
    document: StoreApi<DocumentState>;
    drawing: StoreApi<DrawingState>;
    project: StoreApi<ProjectState>;
}

export type WorkspaceSlot = keyof WorkspaceStores;

/* The stores of the workspace a component sits in. Null outside one, which is what the fallback is for. */
export const WorkspaceStoresContext = createContext<WorkspaceStores | null>(null);

/* What the code outside React means by "here": the stores it reads and the daemon they are on. */
export interface CurrentWorkspace {
    stores: WorkspaceStores;
    /* The machine this workspace is on now, which a switch changes under the same stores. */
    endpointId: string;
}

let current: CurrentWorkspace | null = null;

/*
 * Which workspace the code outside React means. Everything that runs off a keystroke, a menu or a
 * watcher says "the project in front of me", and with one pane on screen that is this one.
 */
export const setCurrentWorkspace = (workspace: CurrentWorkspace | null): void => {
    current = workspace;
};

export const currentStores = (): WorkspaceStores | null => current?.stores ?? null;

export const currentWorkspaceEndpointId = (): string | null => current?.endpointId ?? null;

/* The same shape zustand's `create` returns, so a store behind this hook reads like any other. */
export interface WorkspaceHook<T> extends StoreApi<T> {
    (): T;
    <U>(selector: (state: T) => U): U;
}

/*
 * One slot of the workspace on screen, as a hook that is also a store. A component reads the
 * workspace it is rendered in; anything outside React reads the one that has the focus. The
 * fallback is the store of no workspace at all: it is what a unit test and the frame before the
 * first workspace is built get, so neither has to know that workspaces exist.
 */
export const workspaceHook = <T>(slot: WorkspaceSlot, fallback: StoreApi<T>): WorkspaceHook<T> => {
    const resolve = (stores: WorkspaceStores | null): StoreApi<T> => (stores === null ? fallback : (stores[slot] as unknown as StoreApi<T>));
    const focused = (): StoreApi<T> => resolve(currentStores());
    const useWorkspaceStore = <U>(selector?: (state: T) => U): T | U => {
        const store = resolve(useContext(WorkspaceStoresContext) ?? currentStores());
        return useStore(store, selector as (state: T) => U);
    };
    const hook = useWorkspaceStore as WorkspaceHook<T>;
    hook.getState = () => focused().getState();
    hook.getInitialState = () => focused().getInitialState();
    // `setState` is two overloads, and a forwarder can only be written as one of them; the cast is the seam.
    hook.setState = ((partial: never, replace?: never): void => focused().setState(partial, replace)) as StoreApi<T>['setState'];
    hook.subscribe = (listener) => focused().subscribe(listener);
    return hook;
};
