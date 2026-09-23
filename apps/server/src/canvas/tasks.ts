import { isCanvasView, type ProjectContent, type Task } from '@ruimte/contracts';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { VerbRefusal, field } from './verb.ts';

/* A result past this is a document, not an answer; the wake shows at most the first 8 KiB of it anyway. */
export const MAX_RESULT_LENGTH = 32_000;

// What a child is told about its task on top of the prompt, so the room it needs is kept free under the prompt's limit.
const BRIEF_ROOM = 240;

export const MAX_TASK_PROMPT_LENGTH = MAX_PROMPT_LENGTH - BRIEF_ROOM;

/*
 * The line a child reads under its prompt. A chat child's last answer is its result, and naming done
 * there made every child call it anyway. A terminal child has no answer the daemon can take, so it
 * calls done; the quoting advice is there because Codex's allow rule cannot parse `$'...'` or a
 * heredoc, which runs the call sandboxed and asks the person for approval.
 */
export const taskBrief = (chat: boolean): string =>
    chat
        ? '\n\n(This is a task from the agent that opened you. End this turn with the result as your last message; that is reported back to it, so no ruimte-context call is needed.)'
        : "\n\n(This is a task from the agent that opened you. When it is finished, run ruimte-context done --result '...' and write a line break as \\n inside those plain single quotes; if you exit without it, the task fails.)";

/* What kind of node or view the caller is in its project, or null when neither names it. */
export const callerKind = (content: ProjectContent, caller: string): string | null => {
    for (const view of content.views) {
        if (view.id === caller) {
            return view.kind;
        }
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === caller);
            if (node) {
                return node.kind;
            }
        }
    }
    return null;
};

/* Refuses a task from anything but a chat: a terminal agent has no turn the daemon can start with the result. */
export const requireChatParent = (content: ProjectContent, caller: string): void => {
    const kind = callerKind(content, caller);
    if (kind !== 'chat') {
        throw new VerbRefusal(
            'not-a-chat-parent',
            `Only a chat can give a task, and you are ${kind === null ? 'not a node of this project' : `a ${kind}`}: a task wakes the chat that gave it with the result, and nothing else can be woken`,
            [
                'see\truimte-context agent\twithout --task it opens the same agent, and ruimte-context read on its id shows what it did once a line runs from it into you'
            ]
        );
    }
};

const firstLine = (text: string): string => field(text.split('\n').find((line) => line.trim() !== '') ?? '').slice(0, 200);

/* One row of `task list`, from the side of the node that asks. */
export const taskLine = (task: Task, nodeId: string): string => {
    const gave = task.parentId === nodeId;
    return [
        'task',
        task.id,
        gave ? 'gave' : 'given',
        task.status,
        gave ? task.childId : task.parentId,
        field(task.title),
        task.wake,
        task.result === null ? '' : firstLine(task.result.text),
        task.batchId ?? '-'
    ].join('\t');
};
