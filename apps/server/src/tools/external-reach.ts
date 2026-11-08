import { ToolRefusal } from '@adecore/agents/context';
import type { ExternalGrant } from '@ruimte/contracts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { CanvasHost } from './host.ts';
import { reachableLines, recentLines, type ReachableProject } from './reach.ts';

/* Whether the credential's scope names this project; a scope of null names them all. */
export function inScope(grant: ExternalGrant, projectId: string): boolean {
    return grant.projects === null || grant.projects.includes(projectId);
}

function reachOf(host: Pick<CanvasHost, 'reach'>): NonNullable<CanvasHost['reach']> {
    if (host.reach === undefined) {
        throw new ToolRefusal('no-projects', 'This machine lists no projects');
    }

    return host.reach;
}

/*
 * The projects of this machine the credential reaches: the open ones and those under Recent, apart from Chats. It
 * replaces the switch `reachOpenProjects` of the agents, and is read at every call, so a narrower scope counts at once.
 */
export async function scopedProjects(host: Pick<CanvasHost, 'reach'>, grant: ExternalGrant): Promise<{ open: ReachableProject[]; recent: ReachableProject[] }> {
    const reach = reachOf(host);
    const [open, recent] = await Promise.all([reach.open(), reach.recent()]);

    return { open: open.filter((project) => inScope(grant, project.projectId)), recent: recent.filter((project) => inScope(grant, project.projectId)) };
}

export function accepted(projects: { open: readonly ReachableProject[]; recent: readonly ReachableProject[] }): string[] {
    return [...reachableLines(projects.open), ...recentLines(projects.recent)];
}

/*
 * The project the field `project` names, as the place a tool works in. Checked at every call: a project outside the
 * scope refuses, and so does one that is not open (`project_open` takes it out of Recent first).
 */
export async function externalPlace(host: Pick<CanvasHost, 'reach'>, grant: ExternalGrant, projectId: string): Promise<IndexedPlace> {
    const projects = await scopedProjects(host, grant);
    const open = projects.open.find((project) => project.projectId === projectId);

    if (open !== undefined) {
        return { projectId: open.projectId, folder: open.folder, canvasId: null };
    }

    if (projects.recent.some((project) => project.projectId === projectId)) {
        throw new ToolRefusal('project-closed', `${projectId} is under Recent; project_open opens it`, accepted(projects));
    }

    throw new ToolRefusal('project-out-of-scope', `${projectId} is no project this credential reaches; project_list lists them`, accepted(projects));
}
