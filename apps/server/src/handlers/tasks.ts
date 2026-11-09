import type { TaskStore } from '@adecore/agents/coordination';
import type { Area } from '../area.ts';

interface TasksDeps {
    tasks: TaskStore;
    children(nodeId: string): string[];
}

export function tasksArea({ tasks, children }: TasksDeps): Area {
    return {
        name: 'tasks',
        sources: [tasks],
        handlers: (dispatcher) => {
            dispatcher.register('task.list', ({ projectId }) => ({ tasks: tasks.ofProject(projectId) }));
            dispatcher.register('agent.children', ({ nodeId }) => ({ nodeIds: children(nodeId) }));
        }
    };
}
