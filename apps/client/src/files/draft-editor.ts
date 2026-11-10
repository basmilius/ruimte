import type { Editor, EditorEngine, EditorOptions } from '@adecore/editor';
import { blankLineEdits } from '@/state/blank-lines';
import { endpointKey } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { type DiskText, type TextDrafts, useTextDrafts } from '@/state/text-drafts';

/*
 * One editor on the shared draft of its file: typing writes the draft, Mod+S and leaving save it, and a
 * change from elsewhere (another editor, a reload) comes back in. Its own edit never echoes.
 */
export function bindDraftEditor(editor: Editor, drafts: TextDrafts, endpointId: string, path: string): () => void {
    const key = endpointKey(endpointId, path);
    const offChange = editor.onChange(() => drafts.edit(endpointId, path, editor.getText()));
    const offSave = editor.onSave(() => {
        void drafts.save(endpointId, path, 'manual');
    });
    const offBlur = editor.onBlur(() => {
        void drafts.save(endpointId, path, 'focusOut');
    });
    // Its own caret line keeps its indentation, since the autosave runs while a person pauses on it.
    const offPrepare = drafts.beforeSave(endpointId, path, () => {
        const edits = blankLineEdits(editor.getText(), editor.getCaret().line);
        if (edits.length > 0) {
            editor.applyEdits(edits);
        }
        // Also with cleanup off, since it marks the text as saved, which is where "modified lines" counts from.
        const { codeTrailingWhitespace, codeEnsureFinalNewline } = useSettings.getState();
        const selections = editor.getSelections();
        const changed = editor.cleanUpWhitespace?.({
            trailingWhitespace: codeTrailingWhitespace,
            keepCaretLines: true,
            ensureFinalNewline: codeEnsureFinalNewline
        });
        // A line break added at the caret at the end of the file would carry the caret to a line of its own, and the next key lands there.
        if (changed === true) {
            editor.setSelections(selections);
        }
    });
    const offDraft = useTextDrafts.subscribe((state, previous) => {
        const row = state.rows[key];
        const text = row?.text;
        if (text !== undefined && text !== previous.rows[key]?.text && text !== editor.getText()) {
            // A reload brought in what is on disk: undo never steps back past it, and "modified lines" counts from there again.
            // Unsaved text (another editor's typing, a merge with what moved on disk) differs from `disk` and stays one undo step.
            const reloaded = text === row?.disk;
            editor.setText(text, { clearHistory: reloaded });
            if (reloaded) {
                editor.markSaved?.();
            }
        }
    });
    return () => {
        offChange();
        offSave();
        offBlur();
        offPrepare();
        offDraft();
    };
}

interface DraftEditorMount {
    editor: Editor;
    /* Disposes the editor and saves; the draft stays until nothing is left unsaved. */
    unmount(): void;
}

/*
 * An editor that opens on the file's draft, or on what the file read as when there is none yet.
 * Taking it down keeps the draft, since a node the canvas culls or draws as a plate disposes its
 * editor and the next one has to open on what was typed.
 */
export function mountDraftEditor(
    engine: EditorEngine,
    element: HTMLElement,
    drafts: TextDrafts,
    target: { endpointId: string; path: string; disk: DiskText },
    options: Omit<EditorOptions, 'text' | 'path'>
): DraftEditorMount {
    const { endpointId, path, disk } = target;
    drafts.open(endpointId, path, disk);
    const editor = engine.mount(element, { ...options, path, text: drafts.draft(endpointId, path)?.text ?? disk.text });
    const unbind = bindDraftEditor(editor, drafts, endpointId, path);
    return {
        editor,
        unmount: () => {
            unbind();
            editor.dispose();
            void drafts.save(endpointId, path, 'focusOut');
        }
    };
}
