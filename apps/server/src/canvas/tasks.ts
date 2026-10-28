import { designNodeChats, isCanvasView, isChatNode, isDesignView, viewChats, type ProjectContent, type Task } from '@ruimte/contracts';
import { MAX_PROMPT_LENGTH } from '@ruimte/actions';
import type { FirstPrompt } from '../agents/pending-prompts.ts';
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
export function taskBrief(chat: boolean): string {
    return `\n\n(${chat ? CHAT_TASK_BRIEF : TERMINAL_TASK_BRIEF})`;
}

const CHAT_TASK_BRIEF =
    'This is a task from the agent that opened you. End this turn with the result as your last message; that is reported back to it, so no ruimte-context call is needed.';
const TERMINAL_TASK_BRIEF =
    "This is a task from the agent that opened you. When it is finished, run ruimte-context done --result '...' and write a line break as \\n inside those plain single quotes; if you exit without it, the task fails.";

/*
 * The first prompt a child of a task is held with. A chat hears the brief beside the prompt and folds it
 * in its thread; a terminal has no notes, and a CLI hears nothing in front of a slash command, so for
 * those it rides in the prompt.
 */
export function taskFirstPrompt(prompt: string, chat: boolean): FirstPrompt {
    if (!chat || prompt.startsWith('/')) {
        return { prompt: `${prompt}${taskBrief(chat)}` };
    }
    return { prompt, brief: CHAT_TASK_BRIEF };
}

/* What kind of node or view the caller is in its project, or null when neither names it. */
export function callerKind(content: ProjectContent, caller: string): string | null {
    for (const view of content.views) {
        if (view.id === caller) {
            // The caller in a design is its chat.
            return isDesignView(view) ? 'chat' : view.kind;
        }
        if (isDesignView(view) && viewChats(view).some((chat) => chat.id === caller)) {
            return 'chat';
        }
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === caller || designNodeChats(candidate).some((chat) => chat.id === caller));
            if (node) {
                return isChatNode(node) ? 'chat' : node.kind;
            }
        }
    }
    return null;
}

/* Refuses a task from anything but a chat: a terminal agent has no turn the daemon can start with the result. */
export function requireChatParent(content: ProjectContent, caller: string, hiddenKind?: string): void {
    const kind = callerKind(content, caller) ?? hiddenKind ?? null;
    if (kind !== 'chat') {
        throw new VerbRefusal(
            'not-a-chat-parent',
            `Only a chat can give a task, and you are ${kind === null ? 'not a node of this project' : `a ${kind}`}: a task wakes the chat that gave it with the result, and nothing else can be woken`,
            [
                'see\truimte-context agent\twithout --task it opens the same agent, and ruimte-context read on its id shows what it did once a line runs from it into you'
            ]
        );
    }
}

function firstLine(text: string): string {
    return field(text.split('\n').find((line) => line.trim() !== '') ?? '').slice(0, 200);
}

/* One row of `task list`, from the side of the node that asks. */
export function taskLine(task: Task, nodeId: string): string {
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
}
