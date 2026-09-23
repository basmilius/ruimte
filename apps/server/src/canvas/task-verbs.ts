import { z } from 'zod';
import { defineActionVerb, defineStandaloneActionVerb, runAction } from './action-verb.ts';
import { MAX_RESULT_LENGTH, MAX_TASK_PROMPT_LENGTH, taskLine } from './tasks.ts';
import { unescapeText } from './text-escapes.ts';
import { MAX_TITLE_LENGTH, titleField } from './verb.ts';

export { MAX_TASK_PROMPT_LENGTH, taskBrief } from './tasks.ts';

export const TASK_LINES: readonly string[] = [
    'task\tWith --task the prompt is the assignment and T its title; only a chat may give one, since only a chat can be woken with the result',
    'task\tA chat child finishes its task with the last answer of its first turn, or earlier with ruimte-context done; one that gave tasks of its own finishes with the turn after they all woke it; a terminal child has to call done, and one that exits without it fails the task',
    'task\tOnce a task settles you are woken once, as soon as you have no turn running, with the results of every task that settled by then; you never have to poll',
    'task\tThe tasks of one team --task call wake you together: only once every one of them settled (done, failed or cancelled), so one slow role holds back the results of the others',
    "task\tA task from agent --task wakes you on its own, also while a team of yours is still out; that wake leaves the team's results out, and they all come in a later wake of their own",
    'task\truimte-context task list lists the ones still open or yet to wake you, with their status; --all adds the history'
];

/*
 * The last line after tasks are given. An agent that is not told to end its turn polls `task list`, links
 * back and reads every child, which costs a call each while the wake comes anyway.
 */
export const nextLine = (team: boolean): string =>
    team
        ? 'next\tEnd your turn now: the results arrive as your next message once every task settled. Do not poll task list, run link new or read the agents for them.'
        : 'next\tEnd your turn once you gave every task you mean to give: the result arrives as your next message once this task settled. Do not poll task list, run link new or read the agent for it.';

const NEEDS_RESULT = '--result needs what came of the task, in quotes';

export const doneVerb = defineStandaloneActionVerb({
    name: 'done',
    action: 'task.complete',
    usage: '--result T | --result-file F',
    params: [
        {
            syntax: '--result T',
            need: 'optional',
            field: 'result',
            text: `The result, at most ${MAX_RESULT_LENGTH} characters; \\n, \\t and \\\\ are read as escapes, so a line break is \\n inside plain single quotes and no $'...', heredoc or pipe is needed; --result - takes it from stdin`
        },
        {
            syntax: '--result-file F',
            need: 'optional',
            field: 'resultFile',
            more: 'not together with --result'
        }
    ],
    detail: [
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
        const settled = await runAction(call, 'task.complete', {
            result: flags.result === undefined ? null : unescapeText(flags.result),
            resultFile: flags['result-file'] ?? null
        });
        return [`done\t${settled.taskId}\t${settled.parentId}`];
    }
});

const TASK_NEW_DETAIL: readonly string[] = [
    'prints\ttask\tid\tnode\twhen\tthe task that was opened, the agent it went to, and now for one that starts as you call or waiting for one that is still in a turn',
    'prints\tnext\tthe last line, saying what to do while the task runs',
    'who\tOnly an agent you opened yourself, which the machine wrote down outside the project: a line into a node is not enough, since two agents that read each other would then be able to set each other to work in turn, without a person ever asking for it',
    'who\tOnly a chat: a terminal is a shell a person types in, and nothing is typed into that, so a terminal takes its task on the line its CLI starts with instead',
    'one\tAn agent holds one task at a time; while one is open a second is refused, naming the one in its way',
    "waiting\tAn agent in a turn keeps that turn: the task opens the turn after it, the way a person's message waits for the turn it was sent into",
    'mode\tThe agent keeps the permission mode it was opened in, which was already no wider than yours; a task never widens it',
    'depth\tNo node is opened here, so neither the depth an agent may open at nor the number of agents you may have open comes in',
    'refusals\tnot-a-chat-parent\tself-task\tunknown-node\tnot-on-a-canvas\tnot-an-agent\tnot-yours\tnot-a-chat\tno-agent\ttask-running\tthe whole set this action refuses with',
    'see\truimte-context agent --task\topens an agent that is not there yet, with a task of its own',
    'see\truimte-context notify\tsends a message along a line, which a chat takes a turn on but never reports back from: a task comes back to you with its result and settles, a message does not',
    ...TASK_LINES,
    'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs'
];

const NEEDS_TARGET = 'task new takes the id of the agent to give the task to';

export const taskNewAction = defineActionVerb('task', {
    name: 'new',
    action: 'task.create',
    usage: '<id> --prompt T | --prompt-file F [--title T]',
    params: [
        { syntax: '<id>', need: 'required', field: 'nodeId' },
        {
            syntax: '--prompt T',
            need: 'required',
            field: 'prompt',
            text: `What the task asks, at most ${MAX_TASK_PROMPT_LENGTH} characters; \\n, \\t and \\\\ are read as escapes`
        },
        { syntax: '--prompt-file F', need: 'optional', field: 'promptFile', more: 'not together with --prompt' },
        {
            syntax: '--title T',
            need: 'optional',
            field: 'title',
            text: `The title of the task, at most ${MAX_TITLE_LENGTH} characters; without one the first line of the prompt`
        }
    ],
    detail: TASK_NEW_DETAIL,
    positionals: z.tuple([z.string({ error: NEEDS_TARGET }).min(1, NEEDS_TARGET)], {
        error: (issue) => (issue.code === 'too_big' ? 'task new takes one id and nothing else; what the task asks goes in --prompt' : NEEDS_TARGET)
    }),
    flags: z.object({
        prompt: z.string().optional(),
        'prompt-file': z.string().min(1, '--prompt-file needs the path of a file').optional(),
        title: titleField('--title', '--title needs the title of the task').optional()
    }),
    async run({ positionals: [id], flags }, call) {
        const given = await runAction(call, 'task.create', {
            nodeId: id,
            prompt: flags.prompt === undefined ? null : unescapeText(flags.prompt),
            promptFile: flags['prompt-file'] ?? null,
            title: flags.title ?? null
        });
        return [`task\t${given.taskId}\t${given.nodeId}\t${given.at}`, nextLine(false)];
    }
});

export const taskListAction = defineActionVerb('task', {
    name: 'list',
    action: 'task.list',
    usage: '[--all]',
    params: [{ syntax: '--all', need: 'no value', field: 'all' }],
    detail: [
        'prints\ttask\tid\tgave|given\tstatus\tnode\ttitle\twake\tresult\tbatch\tone line per task, oldest first; node is the child for a task you gave and the parent for one you were given',
        'current\tWithout --all only what is current: a task still open, or one you gave that settled and has yet to wake you; a note under the list counts what it left out',
        'status\topen\tdone\tfailed\tcancelled\tcancelled is a child a person removed',
        'wake\tpending\tsent\tnone\twhether the chat that gave it has been woken with the result yet; a settled task of a team stays pending until the whole team settled',
        'batch\tThe id shared by the tasks of one team --task call, or - for a task from agent --task',
        'result\tThe first line of the result, at most 200 characters; the whole of it reaches the parent when it is woken',
        ...TASK_LINES
    ],
    positionals: z.tuple([], { error: 'task list takes no arguments' }),
    switches: ['all'],
    flags: z.object({}),
    async run({ switches }, call) {
        const { tasks, hidden } = await runAction(call, 'task.list', { all: switches.has('all') });
        if (tasks.length === 0 && hidden === 0) {
            return ['note\tYou have given no task and were given none; ruimte-context agent --task gives one'];
        }
        const lines = tasks.map((task) => taskLine(task, call.caller));
        if (hidden === 0) {
            return lines;
        }
        const note = `${hidden === 1 ? '1 older task is' : `${hidden} older tasks are`} hidden, settled and already reported; ruimte-context task list --all lists them`;
        return [...lines, tasks.length === 0 ? `note\tNo task is open or waiting to wake you; ${note}` : `note\t${note}`];
    }
});
