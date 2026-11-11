import { useProjectList } from '@/state/project-list';
import { readableTask, useTasks } from '@/state/tasks';
import { fireAndForget } from '@/transport-api/transport';
import { watchPool } from '@/transport/pool-watch';

/*
 * The tasks of every machine this client holds a socket for: they put a word on a line and a mark on
 * a node. The daemon tells every socket about every task it writes; a socket that opens asks once per
 * project the machine lists, and a project that turns up in the list later is asked about then.
 */
export function startTaskWatch(): () => void {
    return watchPool((link, endpointId) => {
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
                // A failed ask leaves the tasks as they were; the next open link asks again.
                void fireAndForget(
                    'task.list',
                    link.request('task.list', { projectId }).then((result) =>
                        useTasks.getState().setProjectTasks(
                            endpointId,
                            projectId,
                            result.tasks.flatMap((task) => readableTask(task) ?? [])
                        )
                    )
                );
            }
        };

        return {
            onOpen: () => {
                // What changed while the socket was closed was told to nobody.
                asked.clear();
                ask();
            },
            subscriptions: [
                link.on('task.changed', (payload) => {
                    const task = readableTask(payload.task);

                    if (task !== null) {
                        useTasks.getState().putTask(endpointId, task);
                    }
                }),
                useProjectList.subscribe(ask)
            ]
        };
    });
}
