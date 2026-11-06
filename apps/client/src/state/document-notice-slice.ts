import type { DocumentState } from '@/state/document';
import type { DocumentKit } from '@/state/document-model';

/* The banner over the views that says what an agent opened, and its one button. */
export function createDocumentNoticeSlice({ set, get }: DocumentKit): Pick<DocumentState, 'showNotice' | 'runNotice' | 'dismissNotice'> {
    return {
        showNotice(notice) {
            // Only the newest agent request matters, and its move is the one an undo must reverse.
            set({ viewNotice: notice });
        },

        runNotice() {
            const action = get().viewNotice?.action ?? null;
            if (action === null) {
                return;
            }
            set({ viewNotice: null });
            if (action.kind === 'project') {
                void import('@/project/open').then(({ openProject }) => openProject(action.endpointId, action.projectId));
                return;
            }
            if (action.kind === 'go') {
                get().setActiveView(action.viewId);
                return;
            }
            get().undoShowView(action.shown);
        },

        dismissNotice() {
            set({ viewNotice: null });
        }
    };
}
