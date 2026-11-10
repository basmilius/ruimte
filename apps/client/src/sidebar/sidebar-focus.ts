import { useProject } from '@/state/project';
import { sidebarProjectKey } from '../project/sidebar-projects';

/*
 * Moving the keyboard to a row of the sidebar, which is where leaving the body of a standalone view
 * lands. The row is a DOM lookup rather than a store: the sidebar owns which rows exist, and a row
 * that is not there (the list is closed) simply takes no focus.
 */
export function focusViewRow(viewId: string): void {
    const { current, currentEndpointId } = useProject.getState();
    const key = current && currentEndpointId ? sidebarProjectKey(currentEndpointId, current.projectId) : null;
    // Compared by value: a project key holds brackets and quotes, which an escaped selector does not survive everywhere.
    const rows = [...document.querySelectorAll<HTMLElement>('[data-sidebar-row]')];
    const rowOf = (id: string): HTMLElement | undefined => rows.find((row) => row.dataset.sidebarRow === id);
    const wanted = [`view:${viewId}`, ...(key === null ? [] : [`${key}:view:${viewId}`, `project:${key}`])];
    wanted
        .map(rowOf)
        .find((row) => row !== undefined)
        ?.focus();
}
