import type { LaunchHost } from '../canvas/verb.ts';
import type { LaunchRunner } from './runner.ts';
import type { LaunchStore } from './store.ts';

/*
 * The launches as the verbs reach them. The actor is fixed to an agent here rather than passed in,
 * so no verb can approve a launch on its way or ask for a person's Force stop.
 */
export function agentLaunches(
    store: Pick<LaunchStore, 'resolveAll'>,
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
        stop: (projectId, launchId) => runner.stop(projectId, launchId)
    };
}
