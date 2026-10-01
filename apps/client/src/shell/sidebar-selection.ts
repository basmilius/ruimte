import { chatsProjects, menuProjects, openableRows } from '@/project/list';
import type { ProjectRow } from '@/state/project-list';
import type { Endpoint } from '@/state/endpoints';

// The menu owns membership; background snapshots only supply the contents of those projects.
export const sidebarSelection = (rows: ProjectRow[], endpoints: Endpoint[], current: ProjectRow | null) => {
    const listed = [...rows];
    if (current && !listed.some((row) => row.endpointId === current.endpointId && row.summary.projectId === current.summary.projectId)) {
        listed.push(current);
    }
    const currentKey = current ? `${current.endpointId}:${current.summary.projectId}` : null;
    const projects = openableRows(menuProjects(listed, endpoints, []).open, currentKey);
    // The Chats project stays out of every other window's sidebar, and its own lists its chats.
    if (current?.summary.scratch === true && endpoints.some((endpoint) => endpoint.id === current.endpointId)) {
        return [...chatsProjects([current], endpoints, []), ...projects];
    }
    return projects;
};
