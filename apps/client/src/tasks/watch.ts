import { useProjectList } from '@/state/project-list';
import { useTasks } from '@/state/tasks';
import { watchPool } from '@/transport/pool-watch';

/*
 * The tasks of every machine this client holds a socket for: they put a word on a line and a mark on
 * a node. The daemon tells every socket about every task it writes; a socket that opens asks once per
 * project the machine lists, and a project that turns up in the list later is asked about then.
 */
export const startTaskWatch = (): (() => void) =>
    watchPool((link, endpointId) => {
        const asked = new Set<string>();
        const ask = (): void => {
            // The project list also moves while the socket is down, and a closed link answers nothing.
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

        return {
            onOpen: () => {
                // What changed while the socket was closed was told to nobody.
                asked.clear();
                ask();
            },
            subscriptions: [link.on('task.changed', (payload) => useTasks.getState().putTask(endpointId, payload.task)), useProjectList.subscribe(ask)]
        };
    });
