import { create } from 'zustand';
import { textDrafts } from '@/state/text-drafts';

export interface PendingClose {
    endpointId: string;
    /* The files that did not save, absolute on the daemon's machine. */
    paths: readonly string[];
    run(): void;
    /* The question was put away without closing: kept editing, or the dialog was dismissed. */
    dismissed?(): void;
}

export const useUnsavedClose = create<{ pending: PendingClose | null }>(() => ({ pending: null }));

/*
 * Closes a tab, a view or a node once what it shows is on disk. A file with unsaved changes is saved
 * first, and only one that will not save (it moved on disk, or the machine said no) is a question.
 */
export function closeAfterSaving(endpointId: string, paths: readonly string[], run: () => void, dismissed?: () => void): void {
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
        // A question that is still up is taken over by this one, which settles it as dismissed.
        useUnsavedClose.getState().pending?.dismissed?.();
        useUnsavedClose.setState({ pending: { endpointId, paths: failed, run, dismissed } });
    });
}

/* Puts the question away without closing anything. */
export function dismissClose(): void {
    const { pending } = useUnsavedClose.getState();
    useUnsavedClose.setState({ pending: null });
    pending?.dismissed?.();
}

/* The answer to that question: the drafts go, the files stay as they are on disk. */
export function closeWithoutSaving(pending: PendingClose): void {
    for (const path of pending.paths) {
        textDrafts.discard(pending.endpointId, path);
    }
    pending.run();
}

export async function retryClose(pending: PendingClose): Promise<void> {
    const saved = await Promise.all(pending.paths.map((path) => textDrafts.save(pending.endpointId, path)));
    if (useUnsavedClose.getState().pending !== pending) {
        return;
    }
    const paths = pending.paths.filter((_, index) => !saved[index]);
    if (paths.length > 0) {
        useUnsavedClose.setState({ pending: { ...pending, paths } });
    } else {
        useUnsavedClose.setState({ pending: null });
        pending.run();
    }
}
