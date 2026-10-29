import { chatsProjects, menuProjects, openableRows } from '@/project/list';
import type { ProjectRow } from '@/state/project-list';
import type { Endpoint } from '@/state/endpoints';

// The menu owns membership; background snapshots only supply the contents of those projects.
export function sidebarSelection(rows: ProjectRow[], endpoints: Endpoint[], current: ProjectRow | null, allOpen = false) {
    const listed = [...rows];
    if (current && !listed.some((row) => row.endpointId === current.endpointId && row.summary.projectId === current.summary.projectId)) {
        listed.push(current);
    }
    const currentKey = current ? `${current.endpointId}:${current.summary.projectId}` : null;
    const projects = openableRows(menuProjects(listed, endpoints, []).open, currentKey);
    // A list of every open project keeps Chats one press away. Otherwise only the window that shows Chats lists it, with its chats.
    if (allOpen) {
        return [...chatsProjects(listed, endpoints, []), ...projects];
    }
    if (current?.summary.scratch === true) {
        return [...chatsProjects([current], endpoints, []), ...projects];
    }
    return projects;
}
