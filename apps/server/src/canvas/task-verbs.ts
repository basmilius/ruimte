import { isCanvasView, type ProjectContent, type Task } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { readResultFile } from './project-paths.ts';
import { unescapeText } from './text-escapes.ts';
import { VerbRefusal, defineVerb, field, orNote, placeOf } from './verb.ts';

/* A result past this is a document, not an answer; the wake shows at most the first 8 KiB of it anyway. */
export const MAX_RESULT_LENGTH = 32_000;

// What a child is told about its task on top of the prompt, so the room it needs is kept free under the prompt's limit.
const BRIEF_ROOM = 240;

export const MAX_TASK_PROMPT_LENGTH = MAX_PROMPT_LENGTH - BRIEF_ROOM;

/*
 * The line a child reads under its prompt. A chat child's last answer of this turn is its result
 * unless it says otherwise; a terminal child has no answer the daemon can take, so it has to say it.
 */
export const taskBrief = (chat: boolean): string =>
    chat
        ? '\n\n(This is a task from the agent that opened you. Your last answer of this turn is reported back to it; ruimte-context done --result "..." reports something else instead.)'
        : '\n\n(This is a task from the agent that opened you. When it is finished, report back with ruimte-context done --result "..."; if you exit without it, the task fails.)';

export const TASK_LINES: readonly string[] = [
    'task\tWith --task the prompt is the assignment and T its title; only a chat may give one, since only a chat can be woken with the result',
    'task\tA chat child finishes its task with the last answer of its first turn, or earlier with ruimte-context done; one that gave tasks of its own finishes with the turn after they all woke it; a terminal child has to call done, and one that exits without it fails the task',
    'task\tOnce a task settles you are woken once, as soon as you have no turn running, with the results of every task that settled by then; you never have to poll',
    'task\tThe tasks of one team --task call wake you together: only once every one of them settled (done, failed or cancelled), so one slow role holds back the results of the others',
    "task\tA task from agent --task wakes you on its own, also while a team of yours is still out; that wake leaves the team's results out, and they all come in a later wake of their own",
    'task\truimte-context tasks lists them with their status'
];

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

/* One row of `tasks`, from the side of the node that asks. */
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

const NEEDS_RESULT = '--result needs what came of the task, in quotes';

export const doneVerb = defineVerb({
    name: 'done',
    usage: '--result T | --result-file F',
    summary: 'Reports the result of the task you were opened with, which wakes the chat that gave it',
    detail: [
        `flag\t--result T\toptional\tThe result, at most ${MAX_RESULT_LENGTH} characters; \\n, \\t and \\\\ are read as escapes, and --result - takes it from stdin`,
        'flag\t--result-file F\toptional\tThe same result out of a file inside the project folder; not together with --result',
        'prints\tdone\ttask id\tparent id\tthe task that settled and the chat that is woken with it',
        "who\tOnly a node opened with --task, while its task is open; the first of done, the end of a chat child's first turn and an exit settles it",
        'chat\tA chat child that calls done during its first turn reports this result instead of its last answer',
        'terminal\tA terminal child has no other way to report back: exiting without done fails the task',
        'refusals\tno-open-task\tresult-twice\tempty-result\tresult-too-long\tthe codes this verb refuses with'
    ],
    positionals: z.tuple([], { error: 'done takes no arguments; the result goes in --result' }),
    flags: z.object({
        result: z.string({ error: NEEDS_RESULT }).optional(),
        'result-file': z.string().min(1, '--result-file needs the path of a file').optional()
    }),
    async run({ flags }, call) {
        if (flags.result !== undefined && flags['result-file'] !== undefined) {
            throw new VerbRefusal('result-twice', '--result and --result-file both carry the result; give one of them');
        }
        const open = call.host.tasks.involving(call.caller).find((task) => task.childId === call.caller && task.status === 'open');
        if (!open) {
            throw new VerbRefusal(
                'no-open-task',
                'You have no open task to report on: done is for a node another chat opened with --task, until that task settles',
                call.host.tasks
                    .involving(call.caller)
                    .filter((task) => task.childId === call.caller)
                    .map((task) => taskLine(task, call.caller))
            );
        }
        let text: string;
        if (flags['result-file'] !== undefined) {
            text = await readResultFile(placeOf(call).folder, flags['result-file'], (path) => call.host.worktreePaths(path));
        } else if (flags.result !== undefined) {
            text = unescapeText(flags.result);
        } else {
            throw new VerbRefusal('empty-result', NEEDS_RESULT);
        }
        text = text.trim();
        if (text === '') {
            throw new VerbRefusal('empty-result', 'The result is empty; say what came of the task, even when that is that nothing could be done');
        }
        if (text.length > MAX_RESULT_LENGTH) {
            throw new VerbRefusal(
                'result-too-long',
                `The result is ${text.length} characters and at most ${MAX_RESULT_LENGTH} fit; put the rest in a file and name it in the result`
            );
        }
        const settled = await call.host.tasks.done(call.caller, text);
        if (!settled) {
            throw new VerbRefusal('no-open-task', 'Your task settled a moment ago, before this result arrived');
        }
        return [`done\t${settled.id}\t${settled.parentId}`];
    }
});

export const tasksVerb = defineVerb({
    name: 'tasks',
    usage: '',
    summary: 'Lists the tasks you gave and the task you were given: id, direction, status, the other node, title, wake, result, batch',
    detail: [
        'prints\ttask\tid\tgave|given\tstatus\tnode\ttitle\twake\tresult\tbatch\tone line per task, oldest first; node is the child for a task you gave and the parent for one you were given',
        'status\topen\tdone\tfailed\tcancelled\tcancelled is a child a person removed',
        'wake\tpending\tsent\tnone\twhether the chat that gave it has been woken with the result yet; a settled task of a team stays pending until the whole team settled',
        'batch\tThe id shared by the tasks of one team --task call, or - for a task from agent --task',
        'result\tThe first line of the result, at most 200 characters; the whole of it reaches the parent when it is woken',
        ...TASK_LINES
    ],
    positionals: z.tuple([], { error: 'tasks takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        placeOf(call);
        const tasks = call.host.tasks.involving(call.caller);
        return orNote(
            tasks.map((task) => taskLine(task, call.caller)),
            'You have given no task and were given none; ruimte-context agent --task gives one'
        );
    }
});
