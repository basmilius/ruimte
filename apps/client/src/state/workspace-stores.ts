import { createContext, useContext, useSyncExternalStore } from 'react';
import { useStore, type StoreApi } from 'zustand';
import type { CanvasState } from '@/state/canvas';
import type { DiagramState } from '@/state/diagram';
import type { DocumentState } from '@/state/document';
import type { DrawingState } from '@/state/drawing';
import type { FlowState } from '@/state/flow';
import type { EditorRegistry } from '@/state/editors';
import type { ProjectState } from '@/state/project';

/*
 * The stores of the open project. A window shows one project, so the app holds one set on module
 * level; a test that wants isolation makes a set of its own (`createWorkspaceStores`). The types come
 * in type-only, so nothing here imports a store at runtime and the store modules can import this one.
 */
export interface WorkspaceStores {
    /* The four that hold a view each are registries, one editor per view the grid has on screen. */
    canvases: EditorRegistry<CanvasState>;
    drawings: EditorRegistry<DrawingState>;
    diagrams: EditorRegistry<DiagramState>;
    flows: EditorRegistry<FlowState>;
    document: StoreApi<DocumentState>;
    project: StoreApi<ProjectState>;
}

/*
 * The view a cell of the split shows. Null outside a cell, where a reader means the cell that has
 * the focus: that is what a dialog, a panel and everything outside the grid are asking about.
 */
export const CellViewContext = createContext<string | null>(null);

/* The same shape zustand's `create` returns, so a store behind this hook reads like any other. */
export interface StoreHook<T> extends StoreApi<T> {
    (): T;
    <U>(selector: (state: T) => U): U;
}

/* A vanilla store as a hook that is also the store. */
export const storeHook = <T>(store: StoreApi<T>): StoreHook<T> => {
    const hook = (<U>(selector?: (state: T) => U): T | U => useStore(store, selector as (state: T) => U)) as StoreHook<T>;
    hook.getState = store.getState;
    hook.getInitialState = store.getInitialState;
    hook.setState = store.setState;
    hook.subscribe = store.subscribe;
    return hook;
};

/* One editor out of a registry: the cell that was asked for, else the one with the focus, else blank. */
export const resolveEditor = <T>(registry: EditorRegistry<T>, cell: string | null): StoreApi<T> => {
    const viewId = cell ?? registry.focused();
    return (viewId === null ? null : registry.peek(viewId)) ?? registry.blank;
};

/*
 * The editor a subtree resolves to, as the store itself: the cell the component is drawn in, else
 * the cell that has the focus, else the blank editor. A component needs this over the hook below
 * when it subscribes or writes rather than reads, since `getState()` would land on the focused cell
 * even while the component sits in one beside it.
 */
export const useEditorStoreOf = <T>(registry: EditorRegistry<T>): StoreApi<T> => {
    const cell = useContext(CellViewContext);
    // The shape rather than the contents: which editor this is changes far less often than what is in it.
    return useSyncExternalStore(registry.subscribeShape, () => resolveEditor(registry, cell));
};

/*
 * A hook over one editor and nothing else. It is deliberately not a store: `useCanvas.getState()`
 * used to read whichever cell had the focus, while `useCanvas(selector)` two lines above it read the
 * cell the component was drawn in, so a drawing beside another one wrote into its neighbor. Without
 * the store half the two cannot disagree, and a reader who really means the focused cell has to
 * write `focusedCanvas()` or `focusedDrawing()`, where it is visible.
 */
export interface EditorHook<T> {
    (): T;
    <U>(selector: (state: T) => U): U;
}

/*
 * One editor of the open project, as a hook. A view with no editor of this kind (a chat where a
 * canvas is asked for) reads the blank one, which is what the single editor held back when a view
 * that was not a canvas left it empty.
 */
export const editorHook = <T>(registry: EditorRegistry<T>): EditorHook<T> =>
    (<U>(selector?: (state: T) => U): T | U => useStore(useEditorStoreOf(registry), selector as (state: T) => U)) as EditorHook<T>;

/*
 * The editor of the cell that has the focus, for code with no cell of its own: a shortcut, a menu of the
 * window, a palette row, a watcher. Anything drawn inside a cell means its own editor and asks for it
 * with `useCanvasStore` or `useDrawingStore`.
 */
export const focusedEditor = <T>(registry: EditorRegistry<T>): StoreApi<T> => resolveEditor(registry, null);
