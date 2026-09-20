import { useProject } from '@/state/project';
import { sidebarProjectKey } from './sidebar-projects';

/*
 * Moving the keyboard to a row of the sidebar, which is where leaving the body of a standalone view
 * lands. The row is a DOM lookup rather than a store: the sidebar owns which rows exist, and a row
 * that is not there (the list is closed) simply takes no focus.
 */
export const focusViewRow = (viewId: string): void => {
    const { current, currentEndpointId } = useProject.getState();
    const local = document.querySelector<HTMLElement>(`[data-sidebar-row="${CSS.escape(`view:${viewId}`)}"]`);
    const key = current && currentEndpointId ? sidebarProjectKey(currentEndpointId, current.projectId) : null;
    const combined = key
        ? (document.querySelector<HTMLElement>(`[data-sidebar-row="${CSS.escape(`${key}:view:${viewId}`)}"]`) ??
          document.querySelector<HTMLElement>(`[data-sidebar-row="${CSS.escape(`project:${key}`)}"]`))
        : null;
    (local ?? combined)?.focus();
};
