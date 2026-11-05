import { ToolRefusal, field } from '@adecore/agents/context';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { CanvasHost } from './host.ts';

/* A project another project's agents may reach: in use on this machine, outside Recent. */
export interface ReachableProject {
    projectId: string;
    name: string;
    folder: string;
}

/*
 * The other projects open on this machine, behind the machine's one switch. Both are read at every
 * call, so turning the switch off or closing a project takes it out of reach for the next one.
 */
export interface ReachHost {
    enabled(): boolean;
    /* Projects outside Recent, including those in the background; Chats is left out. */
    open(): Promise<ReachableProject[]>;
}

export function projectReach(projects: Pick<ProjectStore, 'list'>, enabled: () => boolean): ReachHost {
    return {
        enabled,
        open: async () => (await projects.list()).filter((project) => project.closedAt == null && project.scratch !== true)
    };
}

const SETTING_LINE =
    "setting\treachOpenProjects in this machine's endpoint.json lets agents reach the other open projects; a person turns it on under Agents in the settings";

export function reachableLines(projects: readonly ReachableProject[]): string[] {
    return projects.map((project) => `project\t${project.projectId}\t${field(project.name)}`);
}

/* What `project_list` prints: nothing while the switch is off, else every open project but the caller's own. */
export async function reachableProjects(host: Pick<CanvasHost, 'reach'>, ownProjectId: string | null): Promise<ReachableProject[]> {
    if (host.reach?.enabled() !== true) {
        return [];
    }

    return (await host.reach.open()).filter((project) => project.projectId !== ownProjectId);
}

/*
 * The project the field `project` names, as the place a tool then works in: its folder, and no canvas
 * of the caller's, since the caller stands in another project. Checked again at every call.
 */
export async function reachedPlace(host: Pick<CanvasHost, 'reach' | 'projects'>, caller: string, projectId: string): Promise<IndexedPlace> {
    if (host.reach?.enabled() !== true) {
        throw new ToolRefusal('projects-not-reachable', 'Agents on this machine reach only their own project; project needs the switch a person turns on', [
            SETTING_LINE
        ]);
    }
    const own = host.projects.locate(caller);
    if (own === null) {
        throw new ToolRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
    }
    const open = await host.reach.open();
    const others = open.filter((project) => project.projectId !== own.projectId);
    if (projectId === own.projectId) {
        throw new ToolRefusal('own-project', `${projectId} is your own project; leave project out to work in it`, reachableLines(others));
    }
    const target = others.find((project) => project.projectId === projectId);
    if (target === undefined) {
        throw new ToolRefusal(
            'project-not-open',
            `${projectId} is no project open on this machine; open it from Recent to make it reachable`,
            reachableLines(others)
        );
    }

    return { projectId: target.projectId, folder: target.folder, canvasId: null };
}
