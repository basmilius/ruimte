import { useProjectList } from '@/state/project-list';
import { useTasks } from '@/state/tasks';
import { pool } from '@/transport';

/*
 * The tasks of every machine this client holds a socket for: they put a word on a line and a mark on
 * a node. The daemon tells every socket about every task it writes; a socket that opens asks once per
 * project the machine lists, and a project that turns up in the list later is asked about then.
 */
export const startTaskWatch = (): (() => void) => {
    const watching = new Map<string, { stop: () => void; asked: Set<string>; ask: () => void }>();

    const sync = (): void => {
        const ids = new Set(pool.ids());
        for (const [endpointId, entry] of watching) {
            if (!ids.has(endpointId)) {
                entry.stop();
                watching.delete(endpointId);
            }
        }
        for (const endpointId of ids) {
            const link = watching.has(endpointId) ? null : pool.peek(endpointId);
            if (!link) {
                continue;
            }
            const asked = new Set<string>();
            const ask = (): void => {
                if (link.status !== 'open') {
                    return;
                }
                for (const row of useProjectList.getState().projects) {
                    if (row.endpointId !== endpointId || asked.has(row.summary.projectId)) {
                        continue;
                    }
                    const projectId = row.summary.projectId;
                    asked.add(projectId);
                    // A daemon from before tasks does not know the request; it simply has none.
                    link.request('task.list', { projectId })
                        .then((result) => useTasks.getState().setProjectTasks(endpointId, projectId, result.tasks))
                        .catch(() => undefined);
                }
            };
            const offChanged = link.on('task.changed', (payload) => useTasks.getState().putTask(endpointId, payload.task));
            const offStatus = link.subscribeStatus((status) => {
                if (status === 'open') {
                    // What changed while the socket was closed was told to nobody.
                    asked.clear();
                    ask();
                }
            });
            ask();
            watching.set(endpointId, {
                asked,
                ask,
                stop: () => {
                    offChanged();
                    offStatus();
                }
            });
        }
    };

    sync();
    const offPool = pool.subscribe(sync);
    const offProjects = useProjectList.subscribe(() => {
        for (const entry of watching.values()) {
            entry.ask();
        }
    });
    return () => {
        offPool();
        offProjects();
        for (const entry of watching.values()) {
            entry.stop();
        }
        watching.clear();
    };
};
