import type { TaskWords } from '@adecore/agents/coordination';
import { taskBrief } from '../tools/tasks.ts';

/* What Ruimte's tasks say in a parent's and a child's thread, in the tools of its MCP server. */
export const TASK_WORDS: TaskWords = {
    app: 'Ruimte',
    answerCall: (childId, item) => {
        const target = `agent_answer with id ${JSON.stringify(childId)}, request ${JSON.stringify(item.requestId)}`;
        if (item.questions.length === 1) {
            const multi = item.questions[0]!.multiSelect ? ', several labels in one answer separated by a comma' : '';
            return `${target} and answer "<a choice label as written, or your own words>"${multi}`;
        }
        const shape = Object.fromEntries(item.questions.map((question) => [question.id, '...']));
        return `${target} and answers '${JSON.stringify(shape)}', one answer per question id`;
    },
    // The assignment plus the line a child opened with task also gets.
    assignment: (task) => `${task.prompt}${taskBrief(true)}`,
    restOf: (childId) => `context_read ${childId} shows the rest once a line runs from that node into you; link_new to ${childId} draws it.`
};
