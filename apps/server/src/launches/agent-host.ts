import type { LaunchConfig, LaunchConfigEntry, LaunchConfigKind, LaunchStartResult, LaunchStatus } from '@ruimte/contracts';
import type { LaunchRunner } from './runner.ts';
import type { LaunchStore } from './store.ts';

/* A launch of a project as an agent sees it: what it is, whether a person approved it here, and what runs of it now. */
export interface LaunchReading {
    launchId: string;
    name: string;
    kind: LaunchConfigKind;
    /* A group counts as approved once every launch it starts is. */
    approved: boolean;
    url: string | null;
    port: number | null;
    members: string[];
    /* Null for one that has not run since the daemon started, and for a group. */
    status: LaunchStatus | null;
}

/*
 * The launches of a project. Every start through here is an agent's, so only a launch a person
 * approved on this machine starts, and a stop is Ctrl+C and then SIGTERM, never a kill.
 */
export interface LaunchHost {
    list(projectId: string): Promise<LaunchReading[]>;
    /* The screen and scrollback of the launch's terminal; null when it has not run since the daemon started. */
    text(projectId: string, launchId: string): Promise<string | null>;
    start(projectId: string, launchId: string, restart: boolean): Promise<LaunchStartResult>;
    /* How many of its launches ran and are being stopped. */
    stop(projectId: string, launchId: string): Promise<number>;
    /* The launches as their files hold them, which an agent's edit starts from. */
    entries(projectId: string): Promise<LaunchConfigEntry[]>;
    /* Never an approval: the launch is held until a person approves it as it stands. One that exists keeps its file. */
    save(projectId: string, launch: LaunchConfig, shared: boolean): Promise<void>;
}

/*
 * The launches as the tools reach them. The actor is fixed to an agent here rather than passed in,
 * so no tool can approve a launch on its way or ask for a person's Force stop, and a save is the store's
 * `saveByAgent`, which approves nothing.
 */
export function agentLaunches(
    store: Pick<LaunchStore, 'resolveAll' | 'read' | 'saveByAgent'>,
    runner: Pick<LaunchRunner, 'list' | 'sessionOf' | 'start' | 'restart' | 'stop'>,
    screenOf: (sessionId: string) => Promise<string | null>
): LaunchHost {
    return {
        list: async (projectId) => {
            const resolved = await store.resolveAll(projectId);
            const statuses = new Map(
                runner
                    .list()
                    .filter((status) => status.projectId === projectId)
                    .map((status) => [status.launchId, status])
            );
            const approved = new Set(resolved.filter((entry) => entry.approved).map((entry) => entry.launch.id));
            return resolved.map(({ launch, url, port }) => {
                const members = launch.kind === 'group' ? (launch.launches ?? []) : [];
                return {
                    launchId: launch.id,
                    name: launch.name,
                    kind: launch.kind,
                    approved: launch.kind === 'group' ? members.length > 0 && members.every((id) => approved.has(id)) : approved.has(launch.id),
                    url,
                    port: statuses.get(launch.id)?.port ?? port,
                    members,
                    status: launch.kind === 'group' ? null : (statuses.get(launch.id) ?? null)
                };
            });
        },
        text: async (projectId, launchId) => {
            const sessionId = runner.sessionOf(projectId, launchId);
            return sessionId === null ? null : screenOf(sessionId);
        },
        start: (projectId, launchId, restart) =>
            restart ? runner.restart(projectId, launchId, { actor: 'agent' }) : runner.start(projectId, launchId, { actor: 'agent' }),
        stop: (projectId, launchId) => runner.stop(projectId, launchId),
        entries: async (projectId) => (await store.read(projectId)).launches,
        save: async (projectId, launch, shared) => {
            await store.saveByAgent(projectId, launch, shared);
        }
    };
}
