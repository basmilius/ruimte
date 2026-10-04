import type { TaskWords } from '@ruimte/agents/tasks/wiring';
import { taskBrief } from '../canvas/task-verbs.ts';

/* Sent to the child's CLI: the assignment plus the line a child opened with --task also gets. */
export function taskText(prompt: string): string {
    return `${prompt}${taskBrief(true)}`;
}

/* What Ruimte's tasks say in a parent's and a child's thread, in the verbs of `ruimte-context`. */
export const TASK_WORDS: TaskWords = {
    app: 'Ruimte',
    cli: 'ruimte-context',
    assignment: (task) => taskText(task.prompt),
    restOf: (childId) =>
        `ruimte-context read ${childId} shows the rest once a line runs from that node into you; ruimte-context link new --to ${childId} draws it.`
};
