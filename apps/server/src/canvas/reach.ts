import { z } from 'zod';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { VerbRefusal, field, type CanvasHost } from './verb.ts';

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

/* The verbs that take `--project`; every other one refuses it by name, so nothing crosses by accident. */
export const CROSSING_VERBS: readonly string[] = ['view list', 'node list', 'link list', 'read', 'notify', 'agent', 'team', 'task new'];

/* `--project` in the flags of a verb that crosses, so its parser and its usage know it; the route takes it out before the verb parses. */
export const PROJECT_FLAG = z.string().min(1, '--project needs the id of a project').optional();

/* What `help` says of `--project` on every verb that takes it. */
export const PROJECT_LINE =
    'flag\t--project P\toptional\tWorks in another project open on this machine instead of your own, while a person lets agents reach them; ruimte-context project list lists them, and a canvas there is named with --view';

const SETTING_LINE =
    "setting\treachOpenProjects in this machine's endpoint.json lets agents reach the other open projects; a person turns it on under Agents in the settings";

export function reachableLines(projects: readonly ReachableProject[]): string[] {
    return projects.map((project) => `project\t${project.projectId}\t${field(project.name)}`);
}

/* What `project list` prints: nothing while the switch is off, else every open project but the caller's own. */
export async function reachableProjects(host: Pick<CanvasHost, 'reach'>, ownProjectId: string | null): Promise<ReachableProject[]> {
    if (host.reach?.enabled() !== true) {
        return [];
    }

    return (await host.reach.open()).filter((project) => project.projectId !== ownProjectId);
}

/*
 * The project `--project` names, as the place a verb then works in: its folder, and no canvas of the
 * caller's, since the caller stands in another project. Checked again at every call.
 */
export async function reachedPlace(host: Pick<CanvasHost, 'reach' | 'projects'>, caller: string, projectId: string): Promise<IndexedPlace> {
    if (host.reach?.enabled() !== true) {
        throw new VerbRefusal('projects-not-reachable', 'Agents on this machine reach only their own project; --project needs the switch a person turns on', [
            SETTING_LINE
        ]);
    }
    const own = host.projects.locate(caller);
    if (own === null) {
        throw new VerbRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
    }
    const open = await host.reach.open();
    const others = open.filter((project) => project.projectId !== own.projectId);
    if (projectId === own.projectId) {
        throw new VerbRefusal('own-project', `${projectId} is your own project; leave --project out to work in it`, reachableLines(others));
    }
    const target = others.find((project) => project.projectId === projectId);
    if (target === undefined) {
        throw new VerbRefusal(
            'project-not-open',
            `${projectId} is no project open on this machine; open it from Recent to make it reachable`,
            reachableLines(others)
        );
    }

    return { projectId: target.projectId, folder: target.folder, canvasId: null };
}

/* Takes `--project` out of the words of a verb, which the route answers rather than the verb. */
export function takeProjectFlag(argv: readonly string[]): { project: string | undefined; argv: string[] } {
    const rest: string[] = [];
    let project: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i]!;
        const inline = word.startsWith('--project=');
        if (word !== '--project' && !inline) {
            rest.push(word);
            continue;
        }
        if (project !== undefined) {
            throw new VerbRefusal('duplicate-flag', '--project is given twice');
        }
        const value = inline ? word.slice('--project='.length) : argv[i + 1];
        if (value === undefined || value === '' || (!inline && value.startsWith('--'))) {
            throw new VerbRefusal('missing-value', '--project needs the id of a project; ruimte-context project list lists them');
        }
        project = value;
        if (!inline) {
            i++;
        }
    }

    return { project, argv: rest };
}

/* A verb that never acts in another project, refused before it parses anything. */
export function crossingRefused(verb: string): VerbRefusal {
    return new VerbRefusal(
        'cross-project-refused',
        `${verb} works only in your own project; --project goes with ${CROSSING_VERBS.join(', ')}`,
        CROSSING_VERBS.map((name) => `crosses\t${name}`)
    );
}
