import type { TaskCoordinator, TaskStore } from '@adecore/agents/coordination';
import type { IndexedPlace } from '../projects/project-index.ts';

interface ClosedProjectDeps {
    tasks: Pick<TaskStore, 'involving'>;
    locate(id: string): IndexedPlace | null;
    coordinator: Pick<TaskCoordinator, 'agentEnded'>;
}

/*
 * The last window closed a project, which ends its sessions. An agent another project started there
 * with `--project` fails its task first, saying so, so its parent there is woken once and knows why.
 * Told while the index still places the nodes, since a task settles only for a placed child.
 */
export function failTasksOfClosedProject(deps: ClosedProjectDeps, name: string, nodeIds: readonly string[]): void {
    for (const nodeId of nodeIds) {
        const own = deps.locate(nodeId)?.projectId;
        const elsewhere = deps.tasks
            .involving(nodeId)
            .some((task) => task.childId === nodeId && task.status === 'open' && deps.locate(task.parentId)?.projectId !== own);
        if (elsewhere) {
            deps.coordinator.agentEnded(nodeId, `The project ${name} was closed in its last window, which ended this agent.`);
        }
    }
}
