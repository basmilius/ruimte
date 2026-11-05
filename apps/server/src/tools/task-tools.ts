import { z } from 'zod';
import { titleField } from '../canvas/host.ts';
import { taskLine } from '../canvas/tasks.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineToolkit, PROJECT_INPUT } from './tool.ts';

const NEEDS_TARGET = 'task_new needs id, the agent to give the task to';

/*
 * The last line after tasks are given. An agent that is not told to end its turn polls `task_list`, links
 * back and reads every child, which costs a call each while the wake comes anyway.
 */
export function nextLine(team: boolean): string {
    return team
        ? 'next\tEnd your turn now: the results arrive as your next message once every task settled. Do not poll task_list, call link_new or read the agents for them.'
        : 'next\tEnd your turn once you gave every task you mean to give: the result arrives as your next message once this task settled. Do not poll task_list, call link_new or read the agent for it.';
}

const taskList = defineActionTool('task', {
    name: 'task_list',
    action: 'task.list',
    description: 'Lists the open tasks you gave and the one you were given.',
    annotations: { readOnly: true },
    input: z.object({ all: z.boolean({ error: 'all is true or false' }).optional().describe('Also settled tasks') }),
    async run(input, call) {
        const { tasks, hidden } = await runAction(call, 'task.list', { all: input.all === true });

        if (tasks.length === 0 && hidden === 0) {
            return ['note\tYou have given no task and were given none; agent_start with task gives one'];
        }

        const lines = tasks.map((task) => taskLine(task, call.caller));

        if (hidden === 0) {
            return lines;
        }

        const note = `${hidden === 1 ? '1 older task is' : `${hidden} older tasks are`} hidden, settled and already reported; task_list with all lists them`;

        return [...lines, tasks.length === 0 ? `note\tNo task is open or waiting to wake you; ${note}` : `note\t${note}`];
    }
});

const taskNew = defineActionTool('task', {
    name: 'task_new',
    action: 'task.create',
    description: 'Gives a task to a running agent you opened; its result wakes you.',
    input: z.object({
        id: z.string({ error: NEEDS_TARGET }).min(1, NEEDS_TARGET),
        prompt: z.string({ error: 'prompt says what the task asks, as text' }).optional(),
        title: titleField('title', 'title needs the title of the task').optional(),
        project: PROJECT_INPUT
    }),
    async run(input, call) {
        const given = await runAction(call, 'task.create', { nodeId: input.id, prompt: input.prompt ?? null, promptFile: null, title: input.title ?? null });

        return [`task\t${given.taskId}\t${given.nodeId}\t${given.at}`, nextLine(false)];
    }
});

const taskDone = defineActionTool('task', {
    name: 'task_done',
    action: 'task.complete',
    description: "Reports your task's result and wakes the chat that gave it; a chat child's last message does the same.",
    counter: 'done',
    input: z.object({ result: z.string({ error: 'result needs what came of the task, as text' }).optional() }),
    async run(input, call) {
        const settled = await runAction(call, 'task.complete', { result: input.result ?? null, resultFile: null });

        return [`done\t${settled.taskId}\t${settled.parentId}`];
    }
});

export const taskToolkit = defineToolkit('task', [taskList, taskNew, taskDone]);
