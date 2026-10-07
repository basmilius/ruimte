import i18next from 'i18next';
import type { Transport } from '@/transport/transport';
import { followViewStates } from '@/shell/panels/editor-view-state-host';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { endpointKey, splitKey } from '@/state/keys';
import { isUnsavedDraft, textDrafts, useTextDrafts, type TextDrafts } from '@/state/text-drafts';

/*
 * Saves what is unsaved in a file or folder that is about to move, so the move carries it and no
 * autosave writes the old path again afterwards. The first path that could not be saved, or null.
 */
export async function saveBeforeMove(endpointId: string, path: string, drafts: TextDrafts = textDrafts): Promise<string | null> {
    const prefix = endpointKey(endpointId, path);
    const unsaved = Object.entries(useTextDrafts.getState().rows)
        .filter(([key, draft]) => (key === prefix || key.startsWith(`${prefix}/`)) && isUnsavedDraft(draft))
        .map(([key]) => splitKey(key).id);
    for (const unsavedPath of unsaved) {
        if (!(await drafts.save(endpointId, unsavedPath))) {
            return unsavedPath;
        }
    }
    return null;
}

/* The editors, tabs and places of a file or folder that moved follow it; with `focus` the keyboard goes to the editor of the active tab again. */
export function followMove(endpointId: string, from: string, to: string, focus = false): void {
    const { activeViewId } = useDocument.getState();
    const renamed = useFiles.getState().moved(from, to);
    followViewStates(endpointId, from, to);
    const moved = activeViewId === null ? undefined : renamed.get(activeViewId);
    if (focus && moved !== undefined && moved !== activeViewId) {
        useFiles.getState().requestCaret(moved);
    }
}

function nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

/*
 * Moves a file or folder on the machine and takes what is open on it along. What is unsaved in it is saved first,
 * so the move carries it. `edits: false` says the caller made the edits a move brings, so the servers only hear
 * that it moved. Throws the reason it could not.
 */
export async function moveFile(
    transport: Pick<Transport, 'request'>,
    endpointId: string,
    projectId: string | null,
    from: string,
    to: string,
    options: { edits: boolean; focus?: boolean },
    drafts: TextDrafts = textDrafts
): Promise<void> {
    const unsaved = await saveBeforeMove(endpointId, from, drafts);
    if (unsaved !== null) {
        throw new Error(i18next.t('panels:files.rename.unsaved', { name: nameOf(unsaved) }));
    }
    await transport.request('fs.rename', { path: from, to, ...(projectId === null ? {} : { projectId, edits: options.edits }) });
    followMove(endpointId, from, to, options.focus ?? false);
}
