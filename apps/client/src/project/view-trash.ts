import i18next from 'i18next';
import type { StoreApi } from 'zustand';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import type { DocumentState } from '@/state/document';
import { useToasts } from '@/state/toasts';

type DocumentStore = Pick<StoreApi<DocumentState>, 'getState' | 'subscribe'>;

const toastOf = (viewId: string): string => `deleted-view-${viewId}`;

const watched = new WeakSet<DocumentStore>();

/* A trashed view that goes another way (put back, purged on leaving, deleted by another writer) takes its toast along. */
const watchTrash = (document: DocumentStore): void => {
    if (watched.has(document)) {
        return;
    }
    watched.add(document);
    document.subscribe((state, before) => {
        if (state.trashed === before.trashed) {
            return;
        }
        for (const entry of before.trashed) {
            if (!state.trashed.some((kept) => kept.view.id === entry.view.id)) {
                useToasts.getState().dismiss(toastOf(entry.view.id));
            }
        }
    });
};

/*
 * Says that a view a person deleted is gone, with the way back. What runs on it keeps running until
 * the toast goes, by running out or by being dismissed, and only then does the file lose the view.
 */
export const offerViewUndo = (document: DocumentStore, viewId: string, name: string): void => {
    watchTrash(document);
    useToasts.getState().show({
        id: toastOf(viewId),
        kind: 'deleted',
        title: i18next.t('shell:toasts.deletedView', { name }),
        action: {
            label: i18next.t('common:action.undo'),
            shortcut: CANVAS_SHORTCUTS.undo,
            run: () => {
                document.getState().restoreView(viewId);
            }
        },
        onClose: () => document.getState().purgeTrash(viewId)
    });
};

/* What the undo key does while a deletion is on offer: the newest comes back first. False when there is none. */
export const undoLatestDeletion = (document: DocumentStore): boolean => {
    const latest = document.getState().trashed.at(-1);
    return latest !== undefined && document.getState().restoreView(latest.view.id);
};
