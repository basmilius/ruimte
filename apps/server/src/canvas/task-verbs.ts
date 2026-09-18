import { isAgentKind, isCanvasView, type ProjectContent, type ProjectNode, type Task } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { ownViewOf, refuseOwnView } from './own-view.ts';
import { readPromptFile, readResultFile } from './project-paths.ts';
import { unescapeText } from './text-escapes.ts';
import { MAX_TITLE_LENGTH, VerbRefusal, defineAction, defineVerb, field, orNote, placeOf, titleField, type VerbCall } from './verb.ts';

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

const NEEDS_RESULT = '--result needs what came of the task, in quotes';

export const doneVerb = defineVerb({
    name: 'done',
    usage: '--result T | --result-file F',
    summary: 'Reports the result of the task you were opened with, which wakes the chat that gave it',
    detail: [
        `flag\t--result T\toptional\tThe result, at most ${MAX_RESULT_LENGTH} characters; \\n, \\t and \\\\ are read as escapes, so a line break is \\n inside plain single quotes and no $'...', heredoc or pipe is needed; --result - takes it from stdin`,
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

const NEEDS_PROMPT = '--prompt needs what the task asks, in quotes';

/* What the task asks, from whichever flag carried it, against the room a task's prompt has. */
const taskPromptOf = async (flags: { prompt?: string; 'prompt-file'?: string }, call: VerbCall, folder: string | null): Promise<string> => {
    if (flags.prompt !== undefined && flags['prompt-file'] !== undefined) {
        throw new VerbRefusal('prompt-twice', '--prompt and --prompt-file both say what the task asks; give one of them');
    }
    let prompt: string;
    if (flags['prompt-file'] !== undefined) {
        prompt = await readPromptFile(folder, flags['prompt-file'], (path) => call.host.worktreePaths(path));
    } else if (flags.prompt !== undefined) {
        prompt = unescapeText(flags.prompt);
    } else {
        throw new VerbRefusal('empty-prompt', NEEDS_PROMPT);
    }
    prompt = prompt.trim();
    if (prompt === '') {
        throw new VerbRefusal('empty-prompt', 'The prompt is empty; a task is what it asks, so say what that agent is to do');
    }
    if (prompt.length > MAX_TASK_PROMPT_LENGTH) {
        throw new VerbRefusal(
            'prompt-too-long',
            `The prompt is ${prompt.length} characters and a task takes at most ${MAX_TASK_PROMPT_LENGTH}, since the agent is also told how to report back; put the rest in a file and tell it to read that`
        );
    }
    return prompt;
};

/* The title of a task nobody named: its first line, cut to what a name on the canvas fits. */
const titleFromPrompt = (prompt: string): string =>
    field(prompt.split('\n').find((line) => line.trim() !== '') ?? prompt)
        .trim()
        .slice(0, MAX_TITLE_LENGTH);

/* A node of this project, on whatever canvas it sits: a task travels by lineage, not over a canvas. */
const nodeOf = (content: ProjectContent, id: string): ProjectNode | undefined => {
    for (const view of content.views) {
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === id);
            if (node) {
                return node;
            }
        }
    }
    return undefined;
};

/* The agent nodes this caller opened itself, which is the whole of what it may set to work. */
const openedAgents = (content: ProjectContent, caller: string, madeBy: (nodeId: string) => string | null): ProjectNode[] =>
    content.views.flatMap((view) => (isCanvasView(view) ? view.nodes.filter((node) => isAgentKind(node.kind) && madeBy(node.id) === caller) : []));

const TASK_NEW_DETAIL: readonly string[] = [
    'argument\t<id>\trequired\tThe agent to give the task to, by id; only a chat you opened yourself',
    `flag\t--prompt T\trequired\tWhat the task asks, at most ${MAX_TASK_PROMPT_LENGTH} characters; \\n, \\t and \\\\ are read as escapes`,
    'flag\t--prompt-file F\toptional\tThe same assignment out of a file, for one with exact bytes; not together with --prompt',
    `flag\t--title T\toptional\tThe title of the task, at most ${MAX_TITLE_LENGTH} characters; without one the first line of the prompt`,
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

export const taskNewAction = defineAction('task', {
    name: 'new',
    usage: '<id> --prompt T | --prompt-file F [--title T]',
    summary: 'Gives a task to an agent you opened that is already running, whose result wakes you the way the task of a new one does',
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
        const place = placeOf(call);
        if (id === call.caller) {
            throw new VerbRefusal('self-task', `${id} is you; a task is what you give another agent`);
        }
        const content = await call.host.read(place.projectId);
        requireChatParent(content, call.caller);
        /* Only the nodes this same call would accept, so a refusal answers with what can be asked instead. */
        const lines = (): string[] =>
            orNote(
                openedAgents(content, call.caller, (nodeId) => call.host.madeBy(nodeId)).map((node) => `node\t${node.id}\t${node.kind}\t${field(node.title)}`),
                'You have opened no agent that is still in this project; ruimte-context agent --task opens one with a task of its own'
            );
        const target = nodeOf(content, id);
        if (!target) {
            const own = ownViewOf(content, id);
            if (own) {
                throw refuseOwnView(own, 'there is no node there to give a task to', lines());
            }
            throw new VerbRefusal('unknown-node', `${id} is not a node of this project`, lines());
        }
        if (!isAgentKind(target.kind)) {
            throw new VerbRefusal('not-an-agent', `${id} is a ${target.kind} node; only a terminal or a chat has an agent that could take a task`, lines());
        }
        if (call.host.madeBy(id) !== call.caller) {
            throw new VerbRefusal('not-yours', `${id} is not a node you opened; a task only goes to an agent you opened yourself`, [
                ...lines(),
                `see\truimte-context notify ${id}\tsends it a message along a line, which it acts on itself and never reports back from`
            ]);
        }
        if (target.kind !== 'chat') {
            throw new VerbRefusal(
                'not-a-chat',
                `${id} is a terminal node: a task has to start a turn, and nothing is typed into a shell a person can type in`,
                [
                    ...lines(),
                    `see\truimte-context notify ${id}\tsends it a message its agent hears at the start of its next turn; a terminal is never given a turn either`,
                    'see\truimte-context agent --terminal --task\topens a terminal of its own with the task on the line its CLI starts with'
                ]
            );
        }
        const running = call.host.tasks.involving(id).find((task) => task.childId === id && task.status === 'open');
        if (running) {
            throw new VerbRefusal(
                'task-running',
                `${id} is working on the task "${field(running.title)}" and takes one at a time; wait for its result, which wakes you`,
                [taskLine(running, call.caller), 'see\truimte-context agent --task\topens another agent for work that cannot wait']
            );
        }
        const state = await call.host.tasks.chatState(id);
        if (state === 'none') {
            throw new VerbRefusal('no-agent', `${id} runs no agent yet: nothing was started in it, so there is no turn a task could open`, lines());
        }
        const prompt = await taskPromptOf(flags, call, place.folder);
        const task = await call.host.tasks.give({
            projectId: place.projectId,
            parentId: call.caller,
            childId: id,
            title: flags.title ?? titleFromPrompt(prompt),
            prompt
        });
        return [`task\t${task.id}\t${id}\t${state === 'running' ? 'waiting' : 'now'}`, nextLine(false)];
    }
});

/*
 * Whether a task still asks anything of the node listing it. A task it gave is history once it settled
 * and its wake went out or never will (cancelled, or a parent nobody can wake); a task it was given is
 * history once it settled. An earlier run with the same titles otherwise reads as work still out.
 */
const isCurrentTask = (task: Task, nodeId: string): boolean => task.status === 'open' || (task.parentId === nodeId && task.wake === 'pending');

export const taskListAction = defineAction('task', {
    name: 'list',
    usage: '[--all]',
    summary:
        'Lists the tasks you gave and the task you were given that are still open or have yet to wake you: id, direction, status, the other node, title, wake, result, batch',
    detail: [
        'flag\t--all\tno value\tAlso lists the history: tasks that settled and already woke their chat, and a task you were given that settled',
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
        placeOf(call);
        const tasks = call.host.tasks.involving(call.caller);
        if (tasks.length === 0) {
            return ['note\tYou have given no task and were given none; ruimte-context agent --task gives one'];
        }
        if (switches.has('all')) {
            return tasks.map((task) => taskLine(task, call.caller));
        }
        const current = tasks.filter((task) => isCurrentTask(task, call.caller));
        const older = tasks.length - current.length;
        const lines = current.map((task) => taskLine(task, call.caller));
        if (older === 0) {
            return lines;
        }
        const hidden = `${older === 1 ? '1 older task is' : `${older} older tasks are`} hidden, settled and already reported; ruimte-context task list --all lists them`;
        return [...lines, current.length === 0 ? `note\tNo task is open or waiting to wake you; ${hidden}` : `note\t${hidden}`];
    }
});
