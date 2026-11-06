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
    /* Projects under Recent, which only `project_open` takes; Chats is left out. */
    recent(): Promise<ReachableProject[]>;
    /* Takes a project back out of Recent. No client holds it for this, so no window shows it and no launch starts. */
    reopen(projectId: string): Promise<void>;
    /* Tells the clients with `fromProjectId` on screen; false when nobody had it there. */
    ask(kind: 'activate' | 'askClose', fromProjectId: string, projectId: string, by: string): boolean;
}

export function projectReach(projects: Pick<ProjectStore, 'list' | 'openProject' | 'askAboutProject'>, enabled: () => boolean): ReachHost {
    const listed = async (recent: boolean): Promise<ReachableProject[]> =>
        (await projects.list())
            .filter((project) => (project.closedAt != null) === recent && project.scratch !== true)
            .map((project) => ({ projectId: project.projectId, name: project.name, folder: project.folder }));

    return {
        enabled,
        open: () => listed(false),
        recent: () => listed(true),
        reopen: async (projectId) => {
            await projects.openProject({ projectId });
        },
        ask: (kind, fromProjectId, projectId, by) => projects.askAboutProject(kind, fromProjectId, projectId, by)
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
    const { target } = await reachedProject(host, caller, projectId, 'project', false);

    return { projectId: target.projectId, folder: target.folder, canvasId: null };
}

export function recentLines(projects: readonly ReachableProject[]): string[] {
    return projects.map((project) => `recent\t${project.projectId}\t${field(project.name)}`);
}

/*
 * Another project of this machine that `name` (the field `project`, or `project_id` of the project
 * tools) names, behind the same switch and never the caller's own or Chats. Only `project_open` takes
 * one under Recent (`withRecent`), so `recent` says which it is. Checked again at every call.
 */
export async function reachedProject(
    host: Pick<CanvasHost, 'reach' | 'projects'>,
    caller: string,
    projectId: string,
    name: string,
    withRecent: boolean
): Promise<{ ownProjectId: string; target: ReachableProject; recent: boolean }> {
    if (host.reach?.enabled() !== true) {
        throw new ToolRefusal('projects-not-reachable', `Agents on this machine reach only their own project; ${name} needs the switch a person turns on`, [
            SETTING_LINE
        ]);
    }
    const own = host.projects.locate(caller);
    if (own === null) {
        throw new ToolRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
    }
    const others = (await host.reach.open()).filter((project) => project.projectId !== own.projectId);
    const recent = withRecent ? await host.reach.recent() : [];
    const accepted = (): string[] => [...reachableLines(others), ...recentLines(recent)];
    if (projectId === own.projectId) {
        const instead = name === 'project' ? 'leave project out to work in it' : `${name} names another one`;
        throw new ToolRefusal('own-project', `${projectId} is your own project; ${instead}`, accepted());
    }
    const open = others.find((project) => project.projectId === projectId);
    if (open !== undefined) {
        return { ownProjectId: own.projectId, target: open, recent: false };
    }
    const closed = recent.find((project) => project.projectId === projectId);
    if (closed !== undefined) {
        return { ownProjectId: own.projectId, target: closed, recent: true };
    }

    throw new ToolRefusal(
        'project-not-open',
        withRecent
            ? `${projectId} is no project of this machine; project_list lists them`
            : `${projectId} is no project open on this machine; project_open takes one back out of Recent`,
        accepted()
    );
}
