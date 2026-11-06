import type { TaskVerbs } from '@adecore/agents/coordination';
import { taskActions } from '../actions/task-actions.ts';
import { taskToolkit } from '../tools/task-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The tasks a chat gives the nodes it opens with `task`, kept by the daemon outside the project. */
        tasks: TaskVerbs;
    }
}

export const taskFeature = defineAgentFeature({
    name: 'task',
    toolkit: taskToolkit,
    actions: taskActions,
    host: ({ work }) => ({ tasks: work.tasks.host })
});
