import type { TaskStore } from '@adecore/agents/coordination';
import type { Dispatcher } from '../dispatcher.ts';

export function registerTaskHandlers(dispatcher: Dispatcher, tasks: TaskStore, children: (nodeId: string) => string[] = () => []): void {
    dispatcher.register('task.list', ({ projectId }) => ({ tasks: tasks.ofProject(projectId) }));
    dispatcher.register('agent.children', ({ nodeId }) => ({ nodeIds: children(nodeId) }));
}
