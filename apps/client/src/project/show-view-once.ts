import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';

/*
 * Puts a view of the open project in front once the document has it: the change that adds a view may
 * land just after the reply or the message that names it. A switch to another project ends the wait.
 */
export const showViewOnceThere = (viewId: string): void => {
    const show = (): boolean => {
        const state = useDocument.getState();
        if (!state.views.some((view) => view.id === viewId)) {
            return false;
        }
        state.setActiveView(viewId);
        return true;
    };
    if (show()) {
        return;
    }
    const projectId = useProject.getState().current?.projectId ?? null;
    const stop = useDocument.subscribe(() => {
        if (useProject.getState().current?.projectId !== projectId || show()) {
            stop();
        }
    });
};
