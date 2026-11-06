import { stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { ToolRefusal, field } from '@adecore/agents/context';
import { isWithin } from '@adecore/utils/path';
import { realOrNull, realOrSelf } from '../disk/real-path.ts';
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
    /* `$RUIMTE_HOME` and the worktree folder a person chose, which no project of an agent's lies in. */
    machineFolders(): string[];
    /* Opens the project a folder already holds, as `reopen` does: nobody holds it for this. */
    openFolder(folder: string): Promise<ReachableProject>;
    /* Asks the clients with `fromProjectId` on screen to make a folder a project; false when nobody had it there. */
    askOpen(fromProjectId: string, folder: string, by: string): boolean;
}

export function projectReach(
    projects: Pick<ProjectStore, 'home' | 'list' | 'openProject' | 'askAboutProject' | 'askToOpenFolder'>,
    enabled: () => boolean,
    worktreeRoot: () => string | null = () => null
): ReachHost {
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
        ask: (kind, fromProjectId, projectId, by) => projects.askAboutProject(kind, fromProjectId, projectId, by),
        machineFolders: () => [projects.home, worktreeRoot()].filter((folder) => folder !== null),
        openFolder: async (folder) => {
            const { summary } = await projects.openProject({ folder });

            return { projectId: summary.projectId, name: summary.name, folder: summary.folder };
        },
        askOpen: (fromProjectId, folder, by) => projects.askToOpenFolder(fromProjectId, folder, by)
    };
}

export const SETTING_LINE =
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
    const { reach, own } = reachingFrom(host, caller, name);
    const others = (await reach.open()).filter((project) => project.projectId !== own.projectId);
    const recent = withRecent ? await reach.recent() : [];
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

/* The switch and the caller's own project, which every call that reaches past it checks first. */
function reachingFrom(host: Pick<CanvasHost, 'reach' | 'projects'>, caller: string, name: string): { reach: ReachHost; own: IndexedPlace } {
    if (host.reach?.enabled() !== true) {
        throw new ToolRefusal('projects-not-reachable', `Agents on this machine reach only their own project; ${name} needs the switch a person turns on`, [
            SETTING_LINE
        ]);
    }

    const own = host.projects.locate(caller);

    if (own === null) {
        throw new ToolRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
    }

    return { reach: host.reach, own };
}

/* A folder that `project_open` may open, as it really is on disk, and whether a project file is already in it. */
export interface ReachedFolder {
    reach: ReachHost;
    ownProjectId: string;
    folder: string;
    hasProject: boolean;
}

/*
 * The folder `folder` of `project_open` names, behind the same switch. Judged by where it really leads,
 * so a link is no way into the machine's own folders, the caller's own project or a project the machine
 * already has, which `project_id` names instead. Checked again at every call.
 */
export async function reachedFolder(host: Pick<CanvasHost, 'reach' | 'projects'>, caller: string, folder: string): Promise<ReachedFolder> {
    const { reach, own } = reachingFrom(host, caller, 'folder');

    if (!isAbsolute(folder)) {
        throw new ToolRefusal('folder-not-absolute', `folder needs an absolute path on this machine; ${folder} is not one`);
    }

    const named = resolve(folder);
    const real = await realOrNull(named);

    if (real === null || !(await stat(real)).isDirectory()) {
        throw new ToolRefusal('folder-not-found', `folder ${folder} is no folder on this machine`);
    }

    for (const machineFolder of reach.machineFolders()) {
        const roots = [resolve(machineFolder), await realOrSelf(resolve(machineFolder))];

        if (roots.some((root) => isWithin(root, named) || isWithin(root, real))) {
            throw new ToolRefusal('machine-folder', `folder ${folder} is inside a folder of Ruimte's own, such as its data folder or the agents' worktrees`);
        }
    }

    if ((await realOrSelf(own.folder)) === real) {
        throw new ToolRefusal('own-project', `folder ${folder} is the folder of your own project; folder names another one`);
    }

    const open = (await reach.open()).filter((project) => project.projectId !== own.projectId);
    const recent = await reach.recent();
    const isFolderOf = async (project: ReachableProject): Promise<boolean> => project.folder === named || (await realOrSelf(project.folder)) === real;

    for (const [projects, lines] of [
        [open, reachableLines],
        [recent, recentLines]
    ] as const) {
        for (const project of projects) {
            if (await isFolderOf(project)) {
                throw new ToolRefusal(
                    'folder-is-project',
                    `folder ${folder} is the folder of ${project.projectId}; open it with project_id instead`,
                    lines([project])
                );
            }
        }
    }

    const projectFile = await stat(join(real, '.ruimte', 'project.json')).catch(() => null);

    return { reach, ownProjectId: own.projectId, folder: real, hasProject: projectFile?.isFile() === true };
}
