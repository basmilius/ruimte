import type { Editor } from '@ruimte/editor';
import { endpointKey } from '@/state/keys';
import { type TextDrafts, useTextDrafts } from '@/state/text-drafts';

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
