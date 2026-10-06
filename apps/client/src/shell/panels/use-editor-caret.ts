import { useMemo, useSyncExternalStore } from 'react';
import type { Editor, EditorPosition } from '@adecore/editor';

const START: EditorPosition = { line: 0, character: 0 };

/* The caret as a store, which hands back the same object until it moves. */
function caretStore(editor: Editor | null): { get(): EditorPosition; subscribe(listener: () => void): () => void } {
    let current = editor?.getCaret() ?? START;
    return {
        get: () => {
            const next = editor?.getCaret() ?? START;
            if (next.line !== current.line || next.character !== current.character) {
                current = next;
            }
            return current;
        },
        subscribe: (listener) => editor?.onCaret(listener) ?? (() => undefined)
    };
}

/* Where the editor's caret is, said again whenever it moves. */
export function useEditorCaret(editor: Editor | null): EditorPosition {
    const store = useMemo(() => caretStore(editor), [editor]);
    return useSyncExternalStore(store.subscribe, store.get);
}
