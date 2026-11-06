import { taskActions } from '../actions/task-actions.ts';
import { taskToolkit } from '../tools/task-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const taskFeature = defineAgentFeature({
    name: 'task',
    toolkit: taskToolkit,
    actions: taskActions,
    host: ({ work }) => ({ tasks: work.tasks.host })
});
