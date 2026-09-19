import type { StoreApi } from 'zustand';
import type { EditorRegistry } from '@/state/editors';
import { editorHook, focusedEditor, useEditorStoreOf, type EditorHook } from '@/state/workspace-stores';

/* The five ways into a registry of editors. A canvas, a drawing and a diagram each offer all five. */
export interface EditorBindings<T> {
    /* What a component reads while it renders: the editor of the cell it is drawn in. */
    use: EditorHook<T>;
    /* The same editor as the store itself, for a component that writes or subscribes rather than reads. */
    useStore(): StoreApi<T>;
    /* The editor of the cell that has the focus, for a shortcut or a palette row with no cell of its own. */
    focused(): StoreApi<T>;
    /* What one view holds right now, which is fresher than anything the daemon has been told. */
    live(viewId: string): T | null;
    /* Every change in every editor on screen, named by the view it happened in. */
    subscribe(listener: (viewId: string, state: T, previous: T) => void): () => void;
}

export const editorBindings = <T>(registry: EditorRegistry<T>): EditorBindings<T> => ({
    use: editorHook(registry),
    useStore: () => useEditorStoreOf(registry),
    focused: () => focusedEditor(registry),
    live: (viewId) => registry.peek(viewId)?.getState() ?? null,
    subscribe: (listener) => registry.subscribe(listener)
});
