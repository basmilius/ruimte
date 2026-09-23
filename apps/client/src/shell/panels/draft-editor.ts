import type { Editor, EditorEngine, EditorOptions } from '@ruimte/editor';
import { endpointKey } from '@/state/keys';
import { type DiskText, type TextDrafts, useTextDrafts } from '@/state/text-drafts';

/*
 * One editor on the shared draft of its file: what is typed goes into the draft, Mod+S and leaving
 * the editor save it, and whatever changes the draft from elsewhere (another editor on the same
 * file, a reload) comes back into this one. The editor's own edit is already its text, so it never
 * echoes.
 */
export const bindDraftEditor = (editor: Editor, drafts: TextDrafts, endpointId: string, path: string): (() => void) => {
    const key = endpointKey(endpointId, path);
    const offChange = editor.onChange(() => drafts.edit(endpointId, path, editor.getText()));
    const offSave = editor.onSave(() => {
        void drafts.save(endpointId, path);
    });
    const offBlur = editor.onBlur(() => {
        void drafts.save(endpointId, path);
    });
    const offDraft = useTextDrafts.subscribe((state, previous) => {
        const text = state.rows[key]?.text;
        if (text !== undefined && text !== previous.rows[key]?.text && text !== editor.getText()) {
            editor.setText(text);
        }
    });
    return () => {
        offChange();
        offSave();
        offBlur();
        offDraft();
    };
};

export interface DraftEditorMount {
    editor: Editor;
    /* Disposes the editor and saves; the draft stays until nothing is left unsaved. */
    unmount(): void;
}

/*
 * An editor that opens on the file's draft, or on what the file read as when there is none yet.
 * Taking it down keeps the draft, since a node the canvas culls or draws as a plate disposes its
 * editor and the next one has to open on what was typed.
 */
export const mountDraftEditor = (
    engine: EditorEngine,
    element: HTMLElement,
    drafts: TextDrafts,
    target: { endpointId: string; path: string; disk: DiskText },
    options: Omit<EditorOptions, 'text' | 'path'>
): DraftEditorMount => {
    const { endpointId, path, disk } = target;
    drafts.open(endpointId, path, disk);
    const editor = engine.mount(element, { ...options, path, text: drafts.draft(endpointId, path)?.text ?? disk.text });
    const unbind = bindDraftEditor(editor, drafts, endpointId, path);
    return {
        editor,
        unmount: () => {
            unbind();
            editor.dispose();
            void drafts.save(endpointId, path);
        }
    };
};
