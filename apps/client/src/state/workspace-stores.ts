import { createContext, useContext, useSyncExternalStore } from 'react';
import { useStore, type StoreApi } from 'zustand';
import type { CanvasState } from '@/state/canvas';
import type { DocumentState } from '@/state/document';
import type { DrawingState } from '@/state/drawing';
import type { EditorRegistry } from '@/state/editors';
import type { ProjectState } from '@/state/project';

/*
 * The stores of one open project. They used to be four singletons, which is what made "one project
 * at a time" a fact of the client rather than a choice: a second project would have booted itself
 * into the same canvas. One set per workspace is what lets two machines' projects be edited side by
 * side. The types come in type-only, so nothing here imports a store at runtime and the store
 * modules can import this one.
 */
export interface WorkspaceStores {
    /* The two that hold a view each are registries, one editor per view the grid has on screen. */
    canvases: EditorRegistry<CanvasState>;
    drawings: EditorRegistry<DrawingState>;
    document: StoreApi<DocumentState>;
    project: StoreApi<ProjectState>;
}

/* The slots holding one store for the whole workspace, as against the two registries beside them. */
export type WorkspaceSlot = 'document' | 'project';
export type EditorSlot = 'canvases' | 'drawings';

/* The stores of the workspace a component sits in. Null outside one, which is what the fallback is for. */
export const WorkspaceStoresContext = createContext<WorkspaceStores | null>(null);

/*
 * The view a cell of the split shows. Null outside a cell, where a reader means the cell that has
 * the focus: that is what a dialog, a panel and everything outside the grid are asking about.
 */
export const CellViewContext = createContext<string | null>(null);

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
    for (const listener of [...currentListeners]) {
        listener();
    }
};

const currentListeners = new Set<() => void>();

/*
 * Fires when another workspace takes the focus. A watcher that is about "the project in front of me"
 * holds on to stores rather than to a hook, so it has to be told when those stores are another set.
 */
export const subscribeCurrentWorkspace = (listener: () => void): (() => void) => {
    currentListeners.add(listener);
    return () => {
        currentListeners.delete(listener);
    };
};

export const currentStores = (): WorkspaceStores | null => current?.stores ?? null;

/*
 * Whether a subtree is the workspace the app means by "here". A chord that acts on a project is bound
 * on the window, because it has to answer with the focus in the sidebar or a panel as well, and this
 * is what keeps it off the project in the pane beside it. Outside every provider there is one
 * workspace and it is this one.
 */
export const isFocusedWorkspace = (stores: WorkspaceStores | null): boolean => stores === null || current === null || current.stores === stores;

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
    return asStore(useWorkspaceStore as WorkspaceHook<T>, focused);
};

/* The registry a subtree resolves in: its workspace's own, else the one of no workspace at all. */
const registryIn = <T>(slot: EditorSlot, fallback: EditorRegistry<T>, stores: WorkspaceStores | null): EditorRegistry<T> =>
    stores === null ? fallback : (stores[slot] as unknown as EditorRegistry<T>);

/* One editor out of a registry: the cell that was asked for, else the one with the focus, else blank. */
const resolveEditor = <T>(registry: EditorRegistry<T>, cell: string | null): StoreApi<T> => {
    const viewId = cell ?? registry.focused();
    return (viewId === null ? null : registry.peek(viewId)) ?? registry.blank;
};

/*
 * The editor a subtree resolves to, as the store itself: the cell the component is drawn in, else
 * the cell that has the focus, else the blank editor. A component needs this over the hook below
 * when it subscribes or writes rather than reads, since `getState()` would land on the focused cell
 * even while the component sits in one beside it.
 */
export const useEditorStoreOf = <T>(slot: EditorSlot, fallback: EditorRegistry<T>): StoreApi<T> => {
    const registry = registryIn(slot, fallback, useContext(WorkspaceStoresContext) ?? currentStores());
    const cell = useContext(CellViewContext);
    // The shape rather than the contents: which editor this is changes far less often than what is in it.
    return useSyncExternalStore(registry.subscribeShape, () => resolveEditor(registry, cell));
};

/*
 * One editor of the workspace on screen, as a hook that is also a store. A view with no editor of
 * this kind (a chat where a canvas is asked for) reads the workspace's blank one, which is what the
 * single editor held back when a view that was not a canvas left it empty.
 */
export const editorHook = <T>(slot: EditorSlot, fallback: EditorRegistry<T>): WorkspaceHook<T> => {
    const focused = (): StoreApi<T> => resolveEditor(registryIn(slot, fallback, currentStores()), null);
    const useEditorStore = <U>(selector?: (state: T) => U): T | U => useStore(useEditorStoreOf(slot, fallback), selector as (state: T) => U);
    return asStore(useEditorStore as WorkspaceHook<T>, focused);
};

/* Hangs the store half on the hook: outside React every call means the workspace that has the focus. */
const asStore = <T>(hook: WorkspaceHook<T>, focused: () => StoreApi<T>): WorkspaceHook<T> => {
    hook.getState = () => focused().getState();
    hook.getInitialState = () => focused().getInitialState();
    // `setState` is two overloads, and a forwarder can only be written as one of them; the cast is the seam.
    hook.setState = ((partial: never, replace?: never): void => focused().setState(partial, replace)) as StoreApi<T>['setState'];
    hook.subscribe = (listener) => focused().subscribe(listener);
    return hook;
};
