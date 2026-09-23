import { create } from 'zustand';
import { textDrafts } from '@/state/text-drafts';

export interface PendingClose {
    endpointId: string;
    /* The files that did not save, absolute on the daemon's machine. */
    paths: readonly string[];
    run(): void;
}

export const useUnsavedClose = create<{ pending: PendingClose | null }>(() => ({ pending: null }));

/*
 * Closes a tab, a view or a node once what it shows is on disk. A file with unsaved changes is saved
 * first, and only one that will not save (it moved on disk, or the machine said no) is a question.
 */
export const closeAfterSaving = (endpointId: string, paths: readonly string[], run: () => void): void => {
    const unsaved = [...new Set(paths)].filter((path) => textDrafts.isUnsaved(endpointId, path));
    if (unsaved.length === 0) {
        run();
        return;
    }
    void Promise.all(unsaved.map((path) => textDrafts.save(endpointId, path))).then((saved) => {
        const failed = unsaved.filter((_, index) => !saved[index]);
        if (failed.length === 0) {
            run();
            return;
        }
        useUnsavedClose.setState({ pending: { endpointId, paths: failed, run } });
    });
};

/* The answer to that question: the drafts go, the files stay as they are on disk. */
export const closeWithoutSaving = (pending: PendingClose): void => {
    for (const path of pending.paths) {
        textDrafts.discard(pending.endpointId, path);
    }
    pending.run();
};
