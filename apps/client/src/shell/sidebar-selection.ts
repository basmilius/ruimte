import { chatsProjects, menuProjects, openableRows } from '@/project/list';
import type { ProjectRow } from '@/state/project-list';
import type { Endpoint } from '@/state/endpoints';

/* The menu owns membership; background snapshots only supply the contents of those projects. Chats
   leads, whichever project is open: all open projects keep it one press away, and Needs you counts its chats. */
export function sidebarSelection(rows: ProjectRow[], endpoints: Endpoint[], current: ProjectRow | null) {
    const listed = [...rows];
    if (current && !listed.some((row) => row.endpointId === current.endpointId && row.summary.projectId === current.summary.projectId)) {
        listed.push(current);
    }
    const currentKey = current ? `${current.endpointId}:${current.summary.projectId}` : null;
    return [...chatsProjects(listed, endpoints, []), ...openableRows(menuProjects(listed, endpoints, []).open, currentKey)];
}
