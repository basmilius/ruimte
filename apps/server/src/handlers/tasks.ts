import type { Dispatcher } from '../dispatcher.ts';
import type { TaskStore } from '../tasks/task-store.ts';

export const registerTaskHandlers = (dispatcher: Dispatcher, tasks: TaskStore): void => {
    dispatcher.register('task.list', ({ projectId }) => ({ tasks: tasks.ofProject(projectId) }));
};
